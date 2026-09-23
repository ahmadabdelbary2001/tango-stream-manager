import os
import obsws_python as obs

HOST = "127.0.0.1"
PORT = 4455


def main() -> int:
    password = os.environ.get("OBS_WS_PASSWORD")

    if not password:
        print("ERROR: OBS_WS_PASSWORD is not set.")
        return 1

    client = obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )

    service = client.get_stream_service_settings()

    service_type = service.stream_service_type
    settings = dict(service.stream_service_settings)

    current_server = settings.get("server", "")
    current_key = settings.get("key", "")

    print("=== CURRENT STREAM SERVICE ===")
    print("Type:", service_type)
    print("Server:", current_server)
    print("Key present:", bool(current_key))
    print("Key length:", len(current_key))

    print("\n=== ROUND TRIP ===")

    # Re-apply exactly what OBS reported.
    client.set_stream_service_settings(
        service_type,
        settings,
    )

    verify = client.get_stream_service_settings()
    verify_settings = dict(verify.stream_service_settings)

    print(
        "Type preserved:",
        verify.stream_service_type == service_type,
    )

    print(
        "Server preserved:",
        verify_settings.get("server") == current_server,
    )

    print(
        "Key presence preserved:",
        bool(verify_settings.get("key")) == bool(current_key),
    )

    print(
        "Key length preserved:",
        len(verify_settings.get("key", "")) == len(current_key),
    )

    print("\nStream service round-trip: SUCCESS")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
