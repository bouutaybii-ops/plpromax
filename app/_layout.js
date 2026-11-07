import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// SafeAreaProvider gives SafeAreaView the screen insets (required on the web).
export default function Layout() {
  return (
    <SafeAreaProvider>
      <Slot />
    </SafeAreaProvider>
  );
}
