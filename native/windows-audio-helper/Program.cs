using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace windows_audio_helper;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            WriteError("missing_command", "Expected a command: list-devices or capture.");
            return 1;
        }

        try
        {
            return args[0] switch
            {
                "list-devices" => ListDevices(),
                "capture" => Capture(args.Skip(1).ToArray()),
                _ => UnknownCommand(args[0])
            };
        }
        catch (Exception exception)
        {
            WriteError("unhandled_exception", exception.Message);
            return 1;
        }
    }

    private static int ListDevices()
    {
        using var enumerator = new MMDeviceEnumerator();
        var defaultDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);

        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            WriteJson(new
            {
                type = "device",
                id = device.ID,
                label = device.FriendlyName,
                kind = "output",
                isDefault = device.ID == defaultDevice.ID
            });
        }

        return 0;
    }

    private static int Capture(string[] args)
    {
        var deviceId = ReadOption(args, "--deviceId");
        if (string.IsNullOrWhiteSpace(deviceId))
        {
            WriteError("missing_device_id", "Expected --deviceId <id>.");
            return 1;
        }

        using var enumerator = new MMDeviceEnumerator();
        using var device = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
            .FirstOrDefault(item => item.ID == deviceId);

        if (device is null)
        {
            WriteError("device_not_found", $"Output device not found: {deviceId}");
            return 1;
        }

        using var capture = new WasapiLoopbackCapture(device);
        var sequence = 0L;
        var stopped = new ManualResetEventSlim(false);

        capture.DataAvailable += (_, eventArgs) =>
        {
            var payload = ConvertToPcm16Mono16k(
                eventArgs.Buffer,
                eventArgs.BytesRecorded,
                capture.WaveFormat.SampleRate,
                capture.WaveFormat.Channels);

            if (payload.Length == 0)
            {
                return;
            }

            sequence += 1;
            WriteJson(new
            {
                type = "chunk",
                sequence,
                timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                sampleRate = 16000,
                channels = 1,
                encoding = "pcm_s16le",
                data = Convert.ToBase64String(payload)
            });
        };

        capture.RecordingStopped += (_, eventArgs) =>
        {
            if (eventArgs.Exception is not null)
            {
                WriteError("recording_stopped", eventArgs.Exception.Message);
            }

            stopped.Set();
        };

        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            capture.StopRecording();
        };

        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            if (capture.CaptureState == CaptureState.Capturing)
            {
                capture.StopRecording();
            }
        };

        WriteJson(new
        {
            type = "started",
            sampleRate = 16000,
            channels = 1,
            encoding = "pcm_s16le"
        });

        capture.StartRecording();
        stopped.Wait();
        return 0;
    }

    private static byte[] ConvertToPcm16Mono16k(
        byte[] buffer,
        int bytesRecorded,
        int sourceSampleRate,
        int sourceChannels)
    {
        if (bytesRecorded <= 0 || sourceChannels <= 0)
        {
            return Array.Empty<byte>();
        }

        var bytesPerSample = 4; // WASAPI loopback uses IEEE float32.
        var frameCount = bytesRecorded / (bytesPerSample * sourceChannels);
        if (frameCount <= 0)
        {
            return Array.Empty<byte>();
        }

        var monoSamples = new float[frameCount];
        for (var frame = 0; frame < frameCount; frame += 1)
        {
            float sum = 0;
            for (var channel = 0; channel < sourceChannels; channel += 1)
            {
                var offset = (frame * sourceChannels + channel) * bytesPerSample;
                sum += BitConverter.ToSingle(buffer, offset);
            }

            monoSamples[frame] = sum / sourceChannels;
        }

        var ratio = sourceSampleRate / 16000.0;
        var outputCount = Math.Max(1, (int)Math.Round(monoSamples.Length / ratio));
        var output = new byte[outputCount * 2];

        for (var index = 0; index < outputCount; index += 1)
        {
            var sourceIndex = Math.Min(monoSamples.Length - 1, (int)Math.Round(index * ratio));
            var sample = Math.Clamp(monoSamples[sourceIndex], -1f, 1f);
            var pcm = (short)Math.Round(sample * short.MaxValue);
            BitConverter.GetBytes(pcm).CopyTo(output, index * 2);
        }

        return output;
    }

    private static string? ReadOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index += 1)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return null;
    }

    private static int UnknownCommand(string command)
    {
        WriteError("unknown_command", $"Unknown command: {command}");
        return 1;
    }

    private static void WriteError(string code, string message)
    {
        WriteJson(new
        {
            type = "error",
            code,
            message
        });
    }

    private static void WriteJson(object value)
    {
        Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
    }
}
