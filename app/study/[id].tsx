import { db } from "@/lib/db";
import { AppSchema } from "@/instant.schema";
import { InstaQLEntity } from "@instantdb/react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
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
import { computeNextReview, shuffle } from "@/lib/srs";

type Card = InstaQLEntity<AppSchema, "cards">;

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.18;

export default function StudyScreen() {
  const { id: setId, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const isSmartMode = mode === "smart";
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
  const [hasBeenFlipped, setHasBeenFlipped] = useState(false);
  const initialized = useRef(false);
  // Tracks which cards have been sent back once via Hard (they get exactly one comeback).
  const hardQueuedRef = useRef(new Set<string>());
  // Tracks cards that were re-queued (Hard or Again) before being swiped right.
  // Cards NOT in this set when swiped right are "first-attempt easy" → marked mastered.
  const seenBeforeRef = useRef(new Set<string>());
  // Initial pile size — used for progress since pile.length alone doesn't account for re-queued cards.
  const sessionTotalRef = useRef(0);

  function startSession(cards: Card[]) {
    const initial = shuffle([...cards]);
    setPile(initial);
    setKnownCount(0);
    setIsFlipped(false);
    setHasBeenFlipped(false);
    hardQueuedRef.current.clear();
    seenBeforeRef.current.clear();
    sessionTotalRef.current = initial.length;
    flipProgress.value = 0;
    translateX.value = 0;
    if (setId) {
      db.transact([db.tx.cardSets[setId].update({
        lastStudiedAt: Date.now(),
        sessionPileIds: JSON.stringify(initial.map((c) => c.id)),
        sessionMode: isSmartMode ? "smart" : "all",
        sessionCompleted: false,
        sessionTotal: initial.length,
      })]);
    }
  }

  function sessionCards() {
    return isSmartMode
      ? originalCards.filter((c) => !c.mastered)
      : [...originalCards];
  }

  useEffect(() => {
    if (!initialized.current && originalCards.length > 0) {
      initialized.current = true;
      const currentMode = isSmartMode ? "smart" : "all";
      const savedCompleted = cardSet?.sessionCompleted;
      const savedPileIdsStr = cardSet?.sessionPileIds;
      const savedMode = cardSet?.sessionMode;
      const savedTotal = cardSet?.sessionTotal;

      if (savedCompleted === false && savedPileIdsStr && savedMode === currentMode) {
        try {
          const savedIds: string[] = JSON.parse(savedPileIdsStr);
          const cardMap = new Map(originalCards.map((c) => [c.id, c]));
          const restoredPile = savedIds.map((id) => cardMap.get(id)).filter((c): c is Card => !!c);
          if (restoredPile.length > 0) {
            const total = Math.max(savedTotal ?? restoredPile.length, restoredPile.length);
            setPile(restoredPile);
            setKnownCount(total - restoredPile.length);
            sessionTotalRef.current = total;
            // Mark all restored cards as "seen before" to prevent false mastery on resume.
            restoredPile.forEach((c) => seenBeforeRef.current.add(c.id));
            flipProgress.value = 0;
            translateX.value = 0;
            return;
          }
        } catch {
          // JSON parse failed — fall through to start fresh
        }
      }

      startSession(sessionCards());
    }
  }, [originalCards.length]);

  const pileRef = useRef<Card[]>([]);
  useEffect(() => {
    pileRef.current = pile;
  }, [pile]);

  const translateX = useSharedValue(0);
  const flipProgress = useSharedValue(0);

  // Reset card position AFTER React commits the new pile so old card never snaps back.
  const prevTopCardIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const topId = pile[0]?.id ?? null;
    if (topId !== prevTopCardIdRef.current) {
      prevTopCardIdRef.current = topId;
      translateX.value = 0;
    }
  }, [pile]);

  const savePile = useCallback((newPile: Card[], isComplete?: boolean, extra?: any[]) => {
    if (!setId) return;
    const cardSetTx = db.tx.cardSets[setId].update({
      sessionPileIds: JSON.stringify(newPile.map((c) => c.id)),
      ...(isComplete ? { sessionCompleted: true } : {}),
    });
    db.transact([cardSetTx, ...(extra ?? [])]);
  }, [setId]);

  const handleFlip = useCallback(() => {
    const next = !isFlipped;
    setIsFlipped(next);
    if (next) setHasBeenFlipped(true);
    flipProgress.value = withTiming(next ? 1 : 0, { duration: 150 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [isFlipped]);

  // Swipe right = Easy in both modes. Always removes card from pile.
  // In smart mode, cards answered correctly on the first attempt (never re-queued) are marked mastered
  // and excluded from all future Smart Study sessions.
  const handleSwipeRight = useCallback(() => {
    const card = pileRef.current[0];
    const newPile = pileRef.current.slice(1);
    const extra: any[] = [];
    if (isSmartMode && card) {
      const isFirstAttempt = !seenBeforeRef.current.has(card.id);
      const srsData = computeNextReview(card, "easy");
      extra.push(db.tx.cards[card.id].update(
        isFirstAttempt ? { ...srsData, mastered: true } : srsData
      ));
      hardQueuedRef.current.delete(card.id);
      seenBeforeRef.current.delete(card.id);
    }
    savePile(newPile, newPile.length === 0, extra);
    flipProgress.value = 0;
    setIsFlipped(false);
    setHasBeenFlipped(false);
    setPile(newPile);
    setKnownCount((c) => c + 1);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [isSmartMode, savePile]);

  // Swipe left = Again.
  // Smart mode: re-queues the card to the end (card will appear again).
  // Study All: one pass — just removes the card (same as right swipe but no success haptic).
  const handleSwipeLeft = useCallback(() => {
    const card = pileRef.current[0];
    flipProgress.value = 0;
    setIsFlipped(false);
    setHasBeenFlipped(false);
    if (isSmartMode) {
      const newPile = [...pileRef.current.slice(1), pileRef.current[0]];
      const extra: any[] = [];
      if (card) {
        seenBeforeRef.current.add(card.id);
        extra.push(db.tx.cards[card.id].update(computeNextReview(card, "again")));
      }
      savePile(newPile, false, extra);
      setPile(newPile);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      const newPile = pileRef.current.slice(1);
      savePile(newPile, newPile.length === 0);
      setPile(newPile);
      setKnownCount((c) => c + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [isSmartMode, savePile]);

  // Hard = re-queues card for exactly one more encounter, then it leaves the pile.
  const handleHard = useCallback(() => {
    const card = pileRef.current[0];
    if (!card) return;
    const srsUpdate = db.tx.cards[card.id].update(computeNextReview(card, "hard"));
    flipProgress.value = 0;
    setIsFlipped(false);
    setHasBeenFlipped(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (hardQueuedRef.current.has(card.id)) {
      // Second encounter after Hard — card is done.
      const newPile = pileRef.current.slice(1);
      hardQueuedRef.current.delete(card.id);
      savePile(newPile, newPile.length === 0, [srsUpdate]);
      setPile(newPile);
      setKnownCount((c) => c + 1);
    } else {
      // First Hard press — mark as seen (not first-attempt easy) and send back once.
      const newPile = [...pileRef.current.slice(1), pileRef.current[0]];
      seenBeforeRef.current.add(card.id);
      hardQueuedRef.current.add(card.id);
      savePile(newPile, false, [srsUpdate]);
      setPile(newPile);
    }
  }, [savePile]);

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
              () => { runOnJS(handleSwipeRight)(); }
            );
          } else if (e.translationX < -SWIPE_THRESHOLD) {
            translateX.value = withTiming(
              -SCREEN_WIDTH * 1.5,
              { duration: 200 },
              () => { runOnJS(handleSwipeLeft)(); }
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
      top: 0, left: 0, right: 0, bottom: 0,
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flipProgress.value, [0, 1], [180, 360]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: "hidden",
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
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
    return <View style={s.center}><ActivityIndicator color={colors.PRIMARY} /></View>;
  }

  if (error) {
    return <View style={s.center}><Text style={{ color: colors.MUTED }}>Error: {error.message}</Text></View>;
  }

  const sessionTotal = sessionTotalRef.current;

  // Done screen — shown when pile is empty after a real session.
  if (initialized.current && pile.length === 0 && sessionTotal > 0) {
    return (
      <View style={s.center}>
        <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.TEXT, marginBottom: 8 }}>
          All done!
        </Text>
        <Text style={{ fontSize: 15, color: colors.MUTED, marginBottom: 48, textAlign: "center" }}>
          You studied {sessionTotal} card{sessionTotal !== 1 ? "s" : ""}
        </Text>
        <Pressable
          style={s.primaryBtn}
          onPress={() => {
            initialized.current = false;
            prevTopCardIdRef.current = null;
            startSession(sessionCards());
            setTimeout(() => { initialized.current = true; }, 0);
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
    // Smart Study started but all cards are mastered — nothing to show.
    if (initialized.current && sessionTotal === 0 && isSmartMode) {
      return (
        <View style={s.center}>
          <Text style={{ fontSize: 56, marginBottom: 16 }}>🏆</Text>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.TEXT, marginBottom: 8 }}>
            All mastered!
          </Text>
          <Text style={{ fontSize: 15, color: colors.MUTED, marginBottom: 48, textAlign: "center" }}>
            Every card in this set is mastered. Use Study All to review them.
          </Text>
          <Pressable style={s.primaryBtn} onPress={() => router.back()}>
            <Text style={s.primaryBtnText}>Back to Sets</Text>
          </Pressable>
        </View>
      );
    }
    return <View style={s.center}><ActivityIndicator color={colors.PRIMARY} /></View>;
  }

  const current = pile[0];
  const progress = sessionTotal > 0 ? knownCount / sessionTotal : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.BG }}>
      <View style={s.progressContainer}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={s.progressText}>{knownCount} / {sessionTotal}</Text>
      </View>

      <View style={s.cardArea}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[s.cardWrapper, cardAnimatedStyle]}>
            <Animated.View style={[s.card, frontStyle]}>
              <View style={s.cardTouchArea}>
                <Text style={s.cardText}>{current.front}</Text>
              </View>
            </Animated.View>

            <Animated.View style={[s.card, s.cardBack, backStyle]}>
              <View style={s.cardTouchArea}>
                <Text style={s.cardText}>{current.back}</Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[
                { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, zIndex: 10 },
                colorOverlayStyle,
              ]}
              pointerEvents="none"
            />
          </Animated.View>
        </GestureDetector>
      </View>

      {/* Hard button area — always present in smart mode so the card never shifts up.
          Invisible until card has been flipped at least once. */}
      {isSmartMode && (
        <View style={s.hardBtnArea}>
          <Pressable
            onPress={handleHard}
            disabled={!hasBeenFlipped}
            style={[s.hardBtn, { opacity: hasBeenFlipped ? 1 : 0 }]}
          >
            <Text style={s.hardBtnText}>Hard</Text>
          </Pressable>
        </View>
      )}

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
      height: 360,
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
    hardBtnArea: {
      height: 76,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    hardBtn: {
      width: "75%" as unknown as number,
      paddingVertical: 16,
      alignItems: "center" as const,
      borderRadius: 16,
      backgroundColor: c.PRIMARY_LIGHT,
      borderWidth: 1.5,
      borderColor: c.PRIMARY,
    },
    hardBtnText: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: c.PRIMARY,
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
