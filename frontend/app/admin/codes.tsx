import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Alert, Share, RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

type Code = {
  code: string;
  video_id: string;
  video_title: string;
  client_id?: string;
  label?: string;
  is_active: boolean;
  expired: boolean;
  current_uses: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string | null;
};

type Wedding = { client_id: string; client_name: string; video_count: number };

export default function CodesScreen() {
  const router = useRouter();
  const [codes, setCodes] = useState<Code[]>([]);
  const [videos, setVideos] = useState<Vid[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [selectedVid, setSelectedVid] = useState<string>("");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresHours, setExpiresHours] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([
        api<{ codes: Code[] }>("/admin/codes"),
        api<{ videos: Vid[] }>("/admin/videos"),
      ]);
      setCodes(c.codes);
      setVideos(v.videos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copié", `Code ${text} copié dans le presse-papier.`);
  };

  const shareCode = async (c: Code) => {
    try {
      await Share.share({
        message: `Votre code CINÉMARIÉS pour « ${c.video_title} » : ${c.code}\n\nOuvrez l'application CINÉMARIÉS et entrez ce code pour débloquer votre film de mariage.`,
      });
    } catch {}
  };

  const revoke = (code: string) => {
    Alert.alert("Révoquer ce code ?", `Le code ${code} sera désactivé.`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Révoquer", style: "destructive",
        onPress: async () => {
          try {
            await api(`/admin/codes/${code}`, { method: "DELETE" });
            await load();
          } catch (e: any) {
            Alert.alert("Erreur", e.message);
          }
        },
      },
    ]);
  };

  const create = async () => {
    if (!selectedClientId) {
      Alert.alert("Erreur", "Sélectionnez un mariage");
      return;
    }
    setCreating(true);
    try {
      const r = await api<{ code: string; video_title: string; video_count: number }>("/admin/codes", {
        method: "POST",
        body: {
          client_id: selectedClientId,
          label: label || null,
          max_uses: maxUses ? parseInt(maxUses, 10) : null,
          expires_in_hours: expiresHours ? parseInt(expiresHours, 10) : null,
        },
      });
      setCreatedCode(r.code);
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setCreating(false);
    }
  };

  const resetCreate = () => {
    setShowCreate(false);
    setSelectedClientId("");
    setLabel("");
    setMaxUses("");
    setExpiresHours("");
    setCreatedCode(null);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="codes-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.title}>Codes de déblocage</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)} testID="create-code-btn">
          <Ionicons name="add" size={22} color="#0A0A0A" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />
          }
        >
          {codes.length === 0 ? (
            <Text style={styles.empty}>Aucun code généré. Cliquez sur + pour en créer un.</Text>
          ) : (
            codes.map((c) => (
              <View key={c.code} style={[styles.card, !c.is_active && { opacity: 0.5 }]} testID={`code-${c.code}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.codeTxt}>{c.code}</Text>
                  <View style={[styles.statusBadge, c.is_active ? styles.statusActive : styles.statusInactive]}>
                    <Text style={c.is_active ? styles.statusActiveTxt : styles.statusInactiveTxt}>
                      {c.expired ? "EXPIRÉ" : c.is_active ? "ACTIF" : "RÉVOQUÉ"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardVideo}>{c.video_title}</Text>
                {c.label ? <Text style={styles.cardLabel}>Client : {c.label}</Text> : null}
                <Text style={styles.cardMeta}>
                  Usages : {c.current_uses}{c.max_uses ? `/${c.max_uses}` : ""}
                  {c.expires_at ? `  ·  Exp : ${new Date(c.expires_at).toLocaleDateString("fr-FR")}` : ""}
                </Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.actBtn} onPress={() => copy(c.code)} testID={`copy-${c.code}`}>
                    <Ionicons name="copy-outline" size={16} color={colors.gold} />
                    <Text style={styles.actTxt}>Copier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actBtn} onPress={() => shareCode(c)} testID={`share-${c.code}`}>
                    <Ionicons name="share-outline" size={16} color={colors.gold} />
                    <Text style={styles.actTxt}>Partager</Text>
                  </TouchableOpacity>
                  {c.is_active && (
                    <TouchableOpacity style={[styles.actBtn, { borderColor: "rgba(211,47,47,0.4)" }]} onPress={() => revoke(c.code)} testID={`revoke-${c.code}`}>
                      <Ionicons name="ban-outline" size={16} color={colors.error} />
                      <Text style={[styles.actTxt, { color: colors.error }]}>Révoquer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={resetCreate}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={styles.modal}>
              {createdCode ? (
                <View style={{ alignItems: "center" }}>
                  <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={48} color={colors.gold} /></View>
                  <Text style={styles.modalTitle}>Code généré !</Text>
                  <Text style={styles.modalBigCode}>{createdCode}</Text>
                  <View style={{ flexDirection: "row", gap: 12, marginTop: spacing.lg }}>
                    <TouchableOpacity style={styles.modalBtn} onPress={() => copy(createdCode)}>
                      <Ionicons name="copy" size={16} color="#0A0A0A" />
                      <Text style={styles.modalBtnTxt}>Copier</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.modalBtnSec} onPress={resetCreate}>
                      <Text style={styles.modalBtnSecTxt}>Fermer</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Nouveau code</Text>
                    <TouchableOpacity onPress={resetCreate}>
                      <Ionicons name="close" size={26} color={colors.ivory} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalLabel}>Mariage</Text>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {weddings.map((w) => (
                      <TouchableOpacity
                        key={w.client_id}
                        style={[styles.vidPick, selectedClientId === w.client_id && styles.vidPickActive]}
                        onPress={() => setSelectedClientId(w.client_id)}
                      >
                        <Text style={[styles.vidPickTxt, selectedClientId === w.client_id && { color: "#0A0A0A", fontWeight: "700" }]}>
                          {w.client_name}  ·  {w.video_count} vidéo{w.video_count > 1 ? "s" : ""}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={styles.modalLabel}>Nom du destinataire (optionnel)</Text>
                  <TextInput style={styles.modalInput} value={label} onChangeText={setLabel} placeholder="Famille Dupont" placeholderTextColor={colors.textDisabled} />

                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalLabel}>Usages max</Text>
                      <TextInput style={styles.modalInput} value={maxUses} onChangeText={(t) => setMaxUses(t.replace(/\D/g, ""))} keyboardType="numeric" placeholder="∞" placeholderTextColor={colors.textDisabled} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalLabel}>Expire (h)</Text>
                      <TextInput style={styles.modalInput} value={expiresHours} onChangeText={(t) => setExpiresHours(t.replace(/\D/g, ""))} keyboardType="numeric" placeholder="∞" placeholderTextColor={colors.textDisabled} />
                    </View>
                  </View>

                  <TouchableOpacity style={styles.modalBtn} onPress={create} disabled={creating} testID="confirm-create-code">
                    {creating ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.modalBtnTxt}>Générer le code</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  title: { flex: 1, color: colors.ivory, fontSize: 20, fontWeight: "700" },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: "rgba(212,175,55,0.12)" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  codeTxt: { color: colors.gold, fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusActive: { backgroundColor: "rgba(46,125,50,0.2)", borderWidth: 1, borderColor: colors.success },
  statusActiveTxt: { color: colors.success, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  statusInactive: { backgroundColor: "rgba(211,47,47,0.15)", borderWidth: 1, borderColor: colors.error },
  statusInactiveTxt: { color: colors.error, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  cardVideo: { color: colors.ivory, fontSize: 14, fontWeight: "600", marginTop: 8 },
  cardLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  cardMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  actTxt: { color: colors.gold, fontSize: 12, fontWeight: "600" },
  empty: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", padding: spacing.xl },
  modalBg: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.7)" },
  modal: { backgroundColor: colors.surfaceElevated, padding: spacing.md, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: colors.border, paddingBottom: spacing.xl },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { color: colors.ivory, fontSize: 20, fontWeight: "700" },
  modalLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.md, marginBottom: 6 },
  modalInput: { backgroundColor: colors.bg, color: colors.ivory, padding: 14, borderRadius: 8, fontSize: 14 },
  vidPick: { padding: 12, marginBottom: 6, backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  vidPickActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  vidPickTxt: { color: colors.ivory, fontSize: 14 },
  modalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, paddingVertical: 16, borderRadius: 8, marginTop: spacing.lg },
  modalBtnTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  modalBtnSec: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  modalBtnSecTxt: { color: colors.ivory, fontWeight: "600" },
  modalBigCode: { color: colors.gold, fontSize: 38, fontWeight: "800", letterSpacing: 6, marginTop: spacing.md },
  successIcon: { marginBottom: spacing.sm },
});
