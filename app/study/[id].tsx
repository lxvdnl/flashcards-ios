import { db } from "@/lib/db";
import { AppSchema } from "@/instant.schema";
import { InstaQLEntity } from "@instantdb/react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  Dimensions,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  interpolateColor,
  Extrapolation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/contexts/ThemeContext";
import type { Colors } from "@/lib/theme";

type Card = InstaQLEntity<AppSchema, "cards">;

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.18;

export default function StudyScreen() {
  const { id: setId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();

  const { isLoading, error, data } = db.useQuery({
    cardSets: {
      cards: {
        $: { order: { createdAt: "asc" } },
      },
      $: { where: { id: setId } },
    },
  });

  const cardSet = data?.cardSets?.[0];
  const originalCards = cardSet?.cards ?? [];

  useEffect(() => {
    if (cardSet?.name) {
      navigation.setOptions({ headerTitle: cardSet.name });
    }
  }, [cardSet?.name]);

  const [pile, setPile] = useState<Card[]>([]);
  const [knownCount, setKnownCount] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && originalCards.length > 0) {
      initialized.current = true;
      setPile([...originalCards]);
    }
  }, [originalCards.length]);

  const pileRef = useRef<Card[]>([]);
  useEffect(() => {
    pileRef.current = pile;
  }, [pile]);

  const translateX = useSharedValue(0);
  const flipProgress = useSharedValue(0);

  const handleFlip = useCallback(() => {
    const next = !isFlipped;
    setIsFlipped(next);
    flipProgress.value = withTiming(next ? 1 : 0, { duration: 150 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [isFlipped]);

  const handleSwipeRight = useCallback(() => {
    translateX.value = 0;
    flipProgress.value = 0;
    setIsFlipped(false);
    setPile((prev) => prev.slice(1));
    setKnownCount((c) => c + 1);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleSwipeLeft = useCallback(() => {
    translateX.value = 0;
    flipProgress.value = 0;
    setIsFlipped(false);
    setPile((prev) => [...prev.slice(1), prev[0]]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .onUpdate((e) => {
          translateX.value = e.translationX;
        })
        .onEnd((e) => {
          if (e.translationX > SWIPE_THRESHOLD) {
            translateX.value = withTiming(
              SCREEN_WIDTH * 1.5,
              { duration: 200 },
              () => {
                runOnJS(handleSwipeRight)();
              }
            );
          } else if (e.translationX < -SWIPE_THRESHOLD) {
            translateX.value = withTiming(
              -SCREEN_WIDTH * 1.5,
              { duration: 200 },
              () => {
                runOnJS(handleSwipeLeft)();
              }
            );
          } else {
            translateX.value = withSpring(0);
          }
        }),
    [handleSwipeRight, handleSwipeLeft]
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(6)
        .onEnd(() => {
          if (Math.abs(translateX.value) < 8) {
            runOnJS(handleFlip)();
          }
        }),
    [handleFlip]
  );

  const gesture = useMemo(
    () => Gesture.Exclusive(panGesture, tapGesture),
    [panGesture, tapGesture]
  );

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
      [-12, 0, 12],
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { translateX: translateX.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  const frontStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flipProgress.value, [0, 1], [0, 180]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: "hidden",
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flipProgress.value, [0, 1], [180, 360]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: "hidden",
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    };
  });

  const peachTint = colors.PEACH_TINT;
  const successTint = colors.SUCCESS_TINT;

  const colorOverlayStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      translateX.value,
      [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD],
      [peachTint, "rgba(255,255,255,0)", successTint]
    );
    return { backgroundColor };
  });

  const s = makeStyles(colors);

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.PRIMARY} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={{ color: colors.MUTED }}>Error: {error.message}</Text>
      </View>
    );
  }

  const totalCards = pile.length + knownCount;

  if (initialized.current && pile.length === 0 && knownCount > 0) {
    return (
      <View style={s.center}>
        <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
        <Text
          style={{
            fontSize: 24,
            fontWeight: "700",
            color: colors.TEXT,
            marginBottom: 8,
          }}
        >
          All done!
        </Text>
        <Text
          style={{
            fontSize: 15,
            color: colors.MUTED,
            marginBottom: 48,
            textAlign: "center",
          }}
        >
          You studied {totalCards} card{totalCards !== 1 ? "s" : ""}
        </Text>
        <Pressable
          style={s.primaryBtn}
          onPress={() => {
            initialized.current = false;
            setPile([...originalCards]);
            setKnownCount(0);
            setIsFlipped(false);
            flipProgress.value = 0;
            translateX.value = 0;
            setTimeout(() => {
              initialized.current = false;
            }, 0);
          }}
        >
          <Text style={s.primaryBtnText}>Study Again</Text>
        </Pressable>
        <Pressable style={s.secondaryBtn} onPress={() => router.back()}>
          <Text style={s.secondaryBtnText}>Back to Sets</Text>
        </Pressable>
      </View>
    );
  }

  if (pile.length === 0) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.PRIMARY} />
      </View>
    );
  }

  const current = pile[0];
  const progress = knownCount / totalCards;

  return (
    <View style={{ flex: 1, backgroundColor: colors.BG }}>
      <View style={s.progressContainer}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={s.progressText}>
          {knownCount} / {totalCards}
        </Text>
      </View>

      <View style={s.cardArea}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[s.cardWrapper, cardAnimatedStyle]}>
            {/* Front face */}
            <Animated.View style={[s.card, frontStyle]}>
              <View style={s.cardTouchArea}>
                <Text style={s.cardText}>{current.front}</Text>
              </View>
            </Animated.View>

            {/* Back face */}
            <Animated.View style={[s.card, s.cardBack, backStyle]}>
              <View style={s.cardTouchArea}>
                <Text style={s.cardText}>{current.back}</Text>
              </View>
            </Animated.View>

            {/* Color overlay */}
            <Animated.View
              style={[
                {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 20,
                  zIndex: 10,
                },
                colorOverlayStyle,
              ]}
              pointerEvents="none"
            />
          </Animated.View>
        </GestureDetector>
      </View>

      <Text style={s.remaining}>{pile.length} remaining</Text>
    </View>
  );
}

function makeStyles(c: Colors) {
  return {
    center: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 32,
      backgroundColor: c.BG,
    },
    progressContainer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 24,
      paddingVertical: 14,
      gap: 12,
    },
    progressTrack: {
      flex: 1,
      height: 5,
      backgroundColor: c.PROGRESS_TRACK,
      borderRadius: 3,
      overflow: "hidden" as const,
    },
    progressFill: {
      height: "100%" as unknown as number,
      backgroundColor: c.PRIMARY,
      borderRadius: 3,
    },
    progressText: {
      fontSize: 13,
      color: c.MUTED,
      minWidth: 36,
      textAlign: "right" as const,
      fontWeight: "500" as const,
    },
    cardArea: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: 24,
    },
    cardWrapper: {
      width: "100%" as unknown as number,
      height: 320,
    },
    card: {
      backgroundColor: c.CARD,
      borderRadius: 20,
      shadowColor: c.CARD_SHADOW,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.22,
      shadowRadius: 14,
      elevation: 5,
      overflow: "hidden" as const,
      borderWidth: 1,
      borderColor: c.BORDER,
    },
    cardBack: {
      backgroundColor: c.CARD_BACK,
    },
    cardTouchArea: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 28,
    },
    cardText: {
      fontSize: 30,
      fontWeight: "600" as const,
      textAlign: "center" as const,
      color: c.TEXT,
      lineHeight: 40,
    },
    remaining: {
      textAlign: "center" as const,
      fontSize: 13,
      color: c.MUTED,
      paddingBottom: 28,
      fontWeight: "400" as const,
    },
    primaryBtn: {
      width: "80%" as unknown as number,
      paddingVertical: 15,
      backgroundColor: c.PRIMARY,
      borderRadius: 12,
      alignItems: "center" as const,
      marginBottom: 12,
      shadowColor: c.PRIMARY,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.22,
      shadowRadius: 8,
      elevation: 3,
    },
    primaryBtnText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600" as const,
    },
    secondaryBtn: {
      width: "80%" as unknown as number,
      paddingVertical: 13,
      backgroundColor: c.PRIMARY_LIGHT,
      borderRadius: 12,
      alignItems: "center" as const,
    },
    secondaryBtnText: {
      color: c.PRIMARY,
      fontSize: 15,
      fontWeight: "500" as const,
    },
  };
}
