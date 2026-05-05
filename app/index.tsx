import { db } from "@/lib/db";
import { AppSchema } from "@/instant.schema";
import { InstaQLEntity } from "@instantdb/react-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "@/contexts/ThemeContext";
import type { Colors } from "@/lib/theme";

type CardSet = InstaQLEntity<AppSchema, "cardSets", { cards: {} }>;

// ─── Theme Toggle ─────────────────────────────────────────────────────────────

const TRACK_W = 52;
const TRACK_H = 28;
const KNOB = 22;
const PAD = 3;
const TRAVEL = TRACK_W - KNOB - PAD * 2;

function ThemeToggle() {
  const { isDark, toggleTheme, colors } = useTheme();
  const offset = useSharedValue(isDark ? TRAVEL : 0);

  useEffect(() => {
    offset.value = withSpring(isDark ? TRAVEL : 0, {
      damping: 20,
      stiffness: 200,
      overshootClamping: true,
    });
  }, [isDark]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      onPress={toggleTheme}
      hitSlop={8}
      style={{ flexDirection: "row", alignItems: "center" }}
    >
      <Text style={{ fontSize: 13, color: colors.MUTED, fontWeight: "500", marginRight: 8 }}>
        {isDark ? "Dark" : "Light"}
      </Text>
      <View
        style={{
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          backgroundColor: isDark ? colors.PRIMARY : "#C8C8CC",
          padding: PAD,
          justifyContent: "center",
        }}
      >
        <Animated.View
          style={[
            {
              width: KNOB,
              height: KNOB,
              borderRadius: KNOB / 2,
              backgroundColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.2,
              shadowRadius: 2,
              elevation: 2,
            },
            knobStyle,
          ]}
        >
          <Ionicons
            name={isDark ? "sunny" : "moon"}
            size={12}
            color={isDark ? colors.PRIMARY : "#8E8E93"}
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}

// ─── Set Card ─────────────────────────────────────────────────────────────────
// Separate component so pressed state is per-item and doesn't use function style
// (function-based Pressable style breaks layout flow on iOS)

function SetCard({
  item,
  colors,
  onPress,
  onLongPress,
}: {
  item: CardSet;
  colors: Colors;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        backgroundColor: pressed ? colors.PRIMARY_LIGHT : colors.CARD,
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderWidth: 1,
        borderColor: colors.BORDER,
        shadowColor: colors.CARD_SHADOW,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
        elevation: 2,
        marginBottom: 10,
      }}
    >
      <Text style={{ fontSize: 17, fontWeight: "600", color: colors.TEXT, marginBottom: 4 }}>
        {item.name}
      </Text>
      <Text style={{ fontSize: 13, color: colors.MUTED }}>
        {item.cards.length === 1 ? "1 card" : `${item.cards.length} cards`}
      </Text>
    </Pressable>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [newSetPressed, setNewSetPressed] = useState(false);

  const { isLoading, error, data } = db.useQuery({
    cardSets: {
      cards: {},
      $: { order: { createdAt: "desc" } },
    },
  });

  function handleDeleteSet(item: CardSet) {
    Alert.alert("Delete Set", `Delete "${item.name}" and all its cards?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          db.transact([
            ...item.cards.map((c) => db.tx.cards[c.id].delete()),
            db.tx.cardSets[item.id].delete(),
          ]);
        },
      },
    ]);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.BG }}>
        <ActivityIndicator color={colors.PRIMARY} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.BG }}>
        <Text style={{ color: colors.MUTED }}>Error: {error.message}</Text>
      </View>
    );
  }

  const cardSets = data?.cardSets ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.BG }}>

      {/* Block 1: Stats + toggle */}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 16,
          backgroundColor: colors.PRIMARY_LIGHT,
          borderRadius: 16,
          paddingVertical: 16,
          paddingHorizontal: 18,
          borderWidth: 1,
          borderColor: colors.BORDER,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: colors.PRIMARY,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            Your sets
          </Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.TEXT, lineHeight: 34 }}>
            {cardSets.length}
            <Text style={{ fontSize: 15, fontWeight: "500", color: colors.MUTED }}>
              {"  "}{cardSets.length === 1 ? "set" : "sets"}
            </Text>
          </Text>
        </View>

        <ThemeToggle />
      </View>

      {/* Block 2: New Set — wrapper aligns right, no alignSelf on Pressable */}
      <View style={{ alignItems: "flex-end", marginHorizontal: 20, marginTop: 20, marginBottom: 6 }}>
        <Pressable
          onPress={() => router.push("/create")}
          onPressIn={() => setNewSetPressed(true)}
          onPressOut={() => setNewSetPressed(false)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 14,
            paddingHorizontal: 22,
            borderRadius: 16,
            borderWidth: 2,
            borderColor: colors.PRIMARY,
            backgroundColor: newSetPressed ? colors.PRIMARY_LIGHT : colors.BG,
            shadowColor: colors.PRIMARY,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: newSetPressed ? 0.1 : 0.22,
            shadowRadius: 8,
            elevation: 3,
          }}
        >
          <Ionicons name="add" size={20} color={colors.PRIMARY} style={{ marginRight: 6 }} />
          <Text style={{ color: colors.PRIMARY, fontSize: 16, fontWeight: "700", letterSpacing: 0.3 }}>
            New Set
          </Text>
        </Pressable>
      </View>

      {/* Card set list */}
      {cardSets.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🗂️</Text>
          <Text style={{ fontSize: 18, fontWeight: "600", color: colors.TEXT, marginBottom: 8, textAlign: "center" }}>
            No sets yet
          </Text>
          <Text style={{ fontSize: 15, color: colors.MUTED, textAlign: "center", lineHeight: 22 }}>
            Tap New Set to create your first flashcard set
          </Text>
        </View>
      ) : (
        <FlatList
          data={cardSets}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <SetCard
              item={item}
              colors={colors}
              onPress={() => router.push(`/study/${item.id}`)}
              onLongPress={() => handleDeleteSet(item)}
            />
          )}
        />
      )}
    </View>
  );
}
