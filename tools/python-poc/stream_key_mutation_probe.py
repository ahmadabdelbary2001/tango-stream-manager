import os
import obsws_python as obs

HOST = "127.0.0.1"
PORT = 4455

TEST_KEY = "POC_NOT_A_REAL_TANGO_KEY_20260924_" + ("X" * 64)


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

    original = client.get_stream_service_settings()

    original_type = original.stream_service_type
    original_settings = dict(original.stream_service_settings)

    original_server = original_settings.get("server", "")
    original_key = original_settings.get("key", "")

    if original_type != "rtmp_custom":
        print(f"ERROR: Expected rtmp_custom, got {original_type!r}")
        return 1

    if not original_key:
        print("ERROR: No current stream key is configured.")
        return 1

    test_passed = False
    restore_passed = False

    print("=== ORIGINAL ===")
    print("Type:", original_type)
    print("Server:", original_server)
    print("Original key present:", True)
    print("Original key length:", len(original_key))

    try:
        print("\n=== APPLY TEST KEY ===")

        modified_settings = dict(original_settings)
        modified_settings["key"] = TEST_KEY

        client.set_stream_service_settings(
            original_type,
            modified_settings,
        )

        changed = client.get_stream_service_settings()
        changed_settings = dict(changed.stream_service_settings)

        changed_key = changed_settings.get("key", "")

        type_preserved = (
            changed.stream_service_type == original_type
        )

        server_preserved = (
            changed_settings.get("server") == original_server
        )

        key_accepted = (
            changed_key == TEST_KEY
        )

        print("Type preserved:", type_preserved)
        print("Server preserved:", server_preserved)
        print("Test key accepted:", key_accepted)
        print("Test key length:", len(changed_key))

        test_passed = (
            type_preserved
            and server_preserved
            and key_accepted
        )

        print(
            "\nMutation test:",
            "SUCCESS" if test_passed else "FAILED",
        )

    finally:
        print("\n=== RESTORE ORIGINAL KEY ===")

        try:
            client.set_stream_service_settings(
                original_type,
                original_settings,
            )

            restored = client.get_stream_service_settings()
            restored_settings = dict(
                restored.stream_service_settings
            )

            restored_key = restored_settings.get("key", "")

            restore_passed = (
                restored.stream_service_type == original_type
                and restored_settings.get("server") == original_server
                and restored_key == original_key
            )

            print(
                "Original configuration restored:",
                restore_passed,
            )

        except Exception as exc:
            print(
                "ERROR restoring original configuration:",
                f"{type(exc).__name__}: {exc}",
            )

    if not test_passed:
        return 1

    if not restore_passed:
        return 1

    print("\nStream key mutation round-trip: SUCCESS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
