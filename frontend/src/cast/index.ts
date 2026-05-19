// Native (iOS / Android via Expo Go) stub.
// A real native Chromecast integration requires `react-native-google-cast`
// and an EAS Build (does not work in Expo Go).
export function useCast() {
  return {
    available: false,
    connected: false,
    deviceName: null as string | null,
    cast: async (_url: string, _title: string, _poster?: string) => false,
    stop: async () => {},
  };
}
