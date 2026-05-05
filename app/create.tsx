import { db } from "@/lib/db";
import { id } from "@instantdb/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import type { Colors } from "@/lib/theme";

type Tab = "manual" | "paste" | "file";
type Pair = { term: string; definition: string };

function parseText(text: string): Pair[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const tabIdx = line.indexOf("\t");
      const commaIdx = line.indexOf(",");
      if (tabIdx !== -1) {
        return {
          term: line.slice(0, tabIdx).trim(),
          definition: line.slice(tabIdx + 1).trim(),
        };
      }
      if (commaIdx !== -1) {
        return {
          term: line.slice(0, commaIdx).trim(),
          definition: line.slice(commaIdx + 1).trim(),
        };
      }
      return null;
    })
    .filter(
      (p): p is Pair => p !== null && p.term.length > 0 && p.definition.length > 0
    );
}

async function saveSet(name: string, pairs: Pair[], onDone: () => void) {
  const trimmed = name.trim();
  const valid = pairs.filter((p) => p.term.trim() && p.definition.trim());
  if (!trimmed) {
    Alert.alert("Missing name", "Please enter a set name.");
    return;
  }
  if (valid.length === 0) {
    Alert.alert("No cards", "Please add at least one term/definition pair.");
    return;
  }

  const setId = id();
  const now = Date.now();

  db.transact([
    db.tx.cardSets[setId].update({ name: trimmed, createdAt: now }),
    ...valid.flatMap((p) => {
      const cardId = id();
      return [
        db.tx.cards[cardId].update({
          front: p.term.trim(),
          back: p.definition.trim(),
          createdAt: now,
        }),
        db.tx.cardSets[setId].link({ cards: cardId }),
      ];
    }),
  ]);

  onDone();
}

// ─── Manual Tab ───────────────────────────────────────────────────────────────

function ManualTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [setName, setSetName] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([
    { term: "", definition: "" },
    { term: "", definition: "" },
  ]);

  function updatePair(idx: number, field: keyof Pair, value: string) {
    setPairs((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.label}>Set name</Text>
      <TextInput
        style={s.input}
        value={setName}
        onChangeText={setSetName}
        placeholder="e.g. French Verbs"
        placeholderTextColor={colors.PLACEHOLDER}
        returnKeyType="next"
      />

      <Text style={[s.label, { marginTop: 20 }]}>Cards</Text>
      {pairs.map((p, i) => (
        <View key={i} style={s.pairRow}>
          <TextInput
            style={[s.input, { flex: 1, marginRight: 8 }]}
            value={p.term}
            onChangeText={(v) => updatePair(i, "term", v)}
            placeholder="Term"
            placeholderTextColor={colors.PLACEHOLDER}
          />
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={p.definition}
            onChangeText={(v) => updatePair(i, "definition", v)}
            placeholder="Definition"
            placeholderTextColor={colors.PLACEHOLDER}
          />
        </View>
      ))}

      <Pressable
        onPress={() => setPairs((prev) => [...prev, { term: "", definition: "" }])}
        style={s.secondaryBtn}
      >
        <Text style={s.secondaryBtnText}>+ Add Card</Text>
      </Pressable>

      <Pressable
        onPress={() => saveSet(setName, pairs, () => router.back())}
        style={s.primaryBtn}
      >
        <Text style={s.primaryBtnText}>Save Set</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Paste Tab ────────────────────────────────────────────────────────────────

function PasteTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [setName, setSetName] = useState("");
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState<Pair[] | null>(null);

  function handleParse() {
    Keyboard.dismiss();
    const parsed = parseText(rawText);
    if (parsed.length === 0) {
      Alert.alert(
        "Nothing parsed",
        "Use one line per card: term,definition  or  term⇥definition"
      );
      return;
    }
    setPreview(parsed);
  }

  return (
    <ScrollView
      contentContainerStyle={s.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.label}>Set name</Text>
      <TextInput
        style={s.input}
        value={setName}
        onChangeText={setSetName}
        placeholder="e.g. French Verbs"
        placeholderTextColor={colors.PLACEHOLDER}
      />

      <Text style={[s.label, { marginTop: 20 }]}>Paste text</Text>
      <Text style={s.hint}>
        One card per line: "term,definition" or "term⇥definition"
      </Text>
      <TextInput
        style={[s.input, { height: 160, textAlignVertical: "top", paddingTop: 12 }]}
        value={rawText}
        onChangeText={(v) => {
          setRawText(v);
          setPreview(null);
        }}
        placeholder={"cat,feline\ndog,canine\ntree,arbre"}
        placeholderTextColor={colors.PLACEHOLDER}
        multiline
      />

      <Pressable onPress={handleParse} style={s.secondaryBtn}>
        <Text style={s.secondaryBtnText}>Parse Preview</Text>
      </Pressable>

      {preview && preview.length > 0 && (
        <View style={s.previewContainer}>
          <Text style={s.label}>{preview.length} cards found</Text>
          {preview.slice(0, 5).map((p, i) => (
            <View key={i} style={s.previewRow}>
              <Text style={s.previewTerm}>{p.term}</Text>
              <Text style={{ color: colors.MUTED, marginHorizontal: 6 }}>→</Text>
              <Text style={s.previewDef} numberOfLines={1}>
                {p.definition}
              </Text>
            </View>
          ))}
          {preview.length > 5 && (
            <Text style={s.hint}>…and {preview.length - 5} more</Text>
          )}
          <Pressable
            onPress={() => saveSet(setName, preview, () => router.back())}
            style={s.primaryBtn}
          >
            <Text style={s.primaryBtnText}>Save {preview.length} Cards</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

// ─── File Tab ─────────────────────────────────────────────────────────────────

function FileTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [setName, setSetName] = useState("");
  const [parsed, setParsed] = useState<Pair[] | null>(null);
  const [picking, setPicking] = useState(false);

  async function handlePickFile() {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "text/comma-separated-values", "public.plain-text"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri);
      const pairs = parseText(content);

      if (pairs.length === 0) {
        Alert.alert(
          "Nothing parsed",
          "File must contain lines in the format: term,definition"
        );
        return;
      }

      setParsed(pairs);
      if (!setName) {
        setSetName(asset.name.replace(/\.(txt|csv)$/i, ""));
      }
    } catch {
      Alert.alert("Error", "Could not read the file.");
    } finally {
      setPicking(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={s.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.label}>Set name</Text>
      <TextInput
        style={s.input}
        value={setName}
        onChangeText={setSetName}
        placeholder="e.g. French Verbs"
        placeholderTextColor={colors.PLACEHOLDER}
      />

      <Text style={[s.label, { marginTop: 20 }]}>Import file</Text>
      <Text style={s.hint}>
        Supported: .txt or .csv — one card per line: "term,definition"
      </Text>

      <Pressable
        onPress={handlePickFile}
        style={[s.secondaryBtn, picking && { opacity: 0.6 }]}
        disabled={picking}
      >
        {picking ? (
          <ActivityIndicator size="small" color={colors.PRIMARY} />
        ) : (
          <Text style={s.secondaryBtnText}>📂  Pick File</Text>
        )}
      </Pressable>

      {parsed && parsed.length > 0 && (
        <View style={s.previewContainer}>
          <Text style={s.label}>{parsed.length} cards found</Text>
          {parsed.slice(0, 5).map((p, i) => (
            <View key={i} style={s.previewRow}>
              <Text style={s.previewTerm}>{p.term}</Text>
              <Text style={{ color: colors.MUTED, marginHorizontal: 6 }}>→</Text>
              <Text style={s.previewDef} numberOfLines={1}>
                {p.definition}
              </Text>
            </View>
          ))}
          {parsed.length > 5 && (
            <Text style={s.hint}>…and {parsed.length - 5} more</Text>
          )}
          <Pressable
            onPress={() => saveSet(setName, parsed, () => router.back())}
            style={s.primaryBtn}
          >
            <Text style={s.primaryBtnText}>Save {parsed.length} Cards</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Root Create Screen ───────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "manual", label: "Manual" },
  { key: "paste", label: "Paste" },
  { key: "file", label: "File" },
];

export default function CreateScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [activeTab, setActiveTab] = useState<Tab>("manual");

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.BG }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.tabBar}>
        <View style={s.tabSegment}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[s.tabItem, activeTab === t.key && s.tabItemActive]}
            >
              <Text
                style={[s.tabText, activeTab === t.key && s.tabTextActive]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === "manual" && <ManualTab />}
      {activeTab === "paste" && <PasteTab />}
      {activeTab === "file" && <FileTab />}
    </KeyboardAvoidingView>
  );
}

// ─── Styles factory ──────────────────────────────────────────────────────────

function makeStyles(c: Colors) {
  return {
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    tabBar: {
      backgroundColor: c.BG,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    tabSegment: {
      flexDirection: "row" as const,
      backgroundColor: c.PRIMARY_LIGHT,
      borderRadius: 10,
      padding: 3,
    },
    tabItem: {
      flex: 1,
      paddingVertical: 8,
      alignItems: "center" as const,
      borderRadius: 8,
    },
    tabItemActive: {
      backgroundColor: c.CARD,
      shadowColor: c.CARD_SHADOW,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 3,
      elevation: 2,
    },
    tabText: {
      fontSize: 14,
      fontWeight: "500" as const,
      color: c.MUTED,
    },
    tabTextActive: {
      color: c.PRIMARY,
      fontWeight: "600" as const,
    },
    label: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: c.MUTED,
      marginBottom: 8,
      textTransform: "uppercase" as const,
      letterSpacing: 0.8,
    },
    hint: {
      fontSize: 12,
      color: c.PLACEHOLDER,
      marginBottom: 10,
      lineHeight: 18,
    },
    input: {
      borderWidth: 1,
      borderColor: c.BORDER,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      backgroundColor: c.CARD,
      color: c.TEXT,
    },
    pairRow: {
      flexDirection: "row" as const,
      marginBottom: 10,
    },
    primaryBtn: {
      marginTop: 20,
      paddingVertical: 15,
      backgroundColor: c.PRIMARY,
      borderRadius: 12,
      alignItems: "center" as const,
      shadowColor: c.PRIMARY,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 3,
    },
    primaryBtnText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600" as const,
      letterSpacing: 0.2,
    },
    secondaryBtn: {
      marginTop: 12,
      paddingVertical: 13,
      backgroundColor: c.PRIMARY_LIGHT,
      borderRadius: 12,
      alignItems: "center" as const,
      minHeight: 46,
      justifyContent: "center" as const,
    },
    secondaryBtnText: {
      color: c.PRIMARY,
      fontSize: 15,
      fontWeight: "500" as const,
    },
    previewContainer: {
      marginTop: 16,
      backgroundColor: c.CARD,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: c.BORDER,
    },
    previewRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 7,
      borderBottomWidth: 1,
      borderBottomColor: c.BORDER,
    },
    previewTerm: {
      fontSize: 14,
      fontWeight: "500" as const,
      color: c.TEXT,
      minWidth: 80,
    },
    previewDef: {
      fontSize: 14,
      color: c.MUTED,
      flex: 1,
    },
  };
}
