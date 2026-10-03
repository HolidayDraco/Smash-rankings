import {
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold_Italic,
  BarlowCondensed_900Black_Italic,
} from "@expo-google-fonts/barlow-condensed";
import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
} from "@expo-google-fonts/barlow";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@sr/ui";
import { AppHeader } from "../components/AppHeader";

export default function RootLayout() {
  // Content renders right away with fallback fonts; the real fonts swap in when loaded (no blank screen).
  useFonts({
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold_Italic,
    BarlowCondensed_900Black_Italic,
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
  });
  return (
    <SafeAreaProvider>
      <Head>
        <meta name="theme-color" content={colors.white} />
        <meta property="og:site_name" content="Smash Rankings" />
        <meta property="og:type" content="website" />
      </Head>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <AppHeader />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.white } }}
        />
      </View>
    </SafeAreaProvider>
  );
}
