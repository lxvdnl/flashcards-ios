import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import "../global.css";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppThemeProvider, useTheme } from "@/contexts/ThemeContext";

function RootLayoutInner() {
  const { colors, isDark } = useTheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  if (!loaded) {
    return null;
  }

  const navTheme = {
    ...DefaultTheme,
    dark: isDark,
    colors: {
      ...DefaultTheme.colors,
      background: colors.BG,
      card: colors.BG,
      text: colors.TEXT,
      primary: colors.PRIMARY,
      border: "transparent",
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.BG }}>
      <ThemeProvider value={navTheme}>
        <Stack
          screenOptions={{
            headerTitleStyle: {
              color: colors.TEXT,
              fontWeight: "600",
              fontSize: 17,
            },
            headerTintColor: colors.PRIMARY,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.BG },
          }}
        >
          <Stack.Screen name="index" options={{ headerTitle: "My Card Sets" }} />
          <Stack.Screen
            name="create"
            options={{ headerTitle: "New Card Set", presentation: "modal" }}
          />
          <Stack.Screen
            name="study/[id]"
            options={{ headerTitle: "Study", headerBackTitle: "Back" }}
          />
          <Stack.Screen name="+not-found" />
        </Stack>
        <StatusBar style={isDark ? "light" : "dark"} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootLayoutInner />
    </AppThemeProvider>
  );
}
