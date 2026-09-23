import os
import obsws_python as obs

password = os.environ["OBS_WS_PASSWORD"]

client = obs.ReqClient(
    host="127.0.0.1",
    port=4455,
    password=password,
    timeout=5,
)

video = client.get_video_settings()

print("=== VIDEO SETTINGS ===")

print("Base width:", video.base_width)
print("Base height:", video.base_height)
print("Output width:", video.output_width)
print("Output height:", video.output_height)
print("FPS numerator:", video.fps_numerator)
print("FPS denominator:", video.fps_denominator)

fps = video.fps_numerator / video.fps_denominator

print("FPS:", fps)

print("\nRaw attributes:")
print(video.attrs())
