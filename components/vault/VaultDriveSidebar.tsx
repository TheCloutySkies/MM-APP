import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState, type ComponentProps } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { TacticalPalette } from "@/constants/TacticalTheme";
import type { OpsDocKind } from "@/lib/opsReports";

export type VaultDriveNav = "my" | "recent" | "trash" | "cloud";

export type VaultDriveSidebarSection = "private" | OpsDocKind;

type OpsFolderItem = { id: OpsDocKind; label: string };

type Props = {
  activeSection: VaultDriveSidebarSection;
  onSelectSection: (s: VaultDriveSidebarSection) => void;
  driveNav: VaultDriveNav;
  onChangeNav: (n: VaultDriveNav) => void;
  onUploadFile: () => void;
  onNewFolder: () => void;
  onOpenTeamHub: () => void;
  opsFolders: OpsFolderItem[];
};

export function VaultDriveSidebar({
  activeSection,
  onSelectSection,
  driveNav,
  onChangeNav,
  onUploadFile,
  onNewFolder,
  onOpenTeamHub,
  opsFolders,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const isFileVault = activeSection === "private";

  const navRow = (
    id: VaultDriveNav,
    icon: ComponentProps<typeof FontAwesome>["name"],
    label: string,
    active: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={id}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        {
          backgroundColor: active ? TacticalPalette.panel : pressed ? TacticalPalette.charcoal : "transparent",
          borderLeftWidth: 3,
          borderLeftColor: active ? TacticalPalette.accent : "transparent",
        },
      ]}>
      <FontAwesome name={icon} size={16} color={active ? TacticalPalette.accent : TacticalPalette.boneMuted} />
      <Text style={[styles.navLabel, { color: active ? TacticalPalette.bone : TacticalPalette.boneMuted }]}>{label}</Text>
    </Pressable>
  );

  const opsFolderRow = (item: OpsFolderItem) => {
    const active = activeSection === item.id;
    return (
      <Pressable
        key={item.id}
        onPress={() => onSelectSection(item.id)}
        style={({ pressed }) => [
          styles.navRow,
          styles.opsFolderRow,
          {
            backgroundColor: active ? TacticalPalette.panel : pressed ? TacticalPalette.charcoal : "transparent",
            borderLeftWidth: 3,
            borderLeftColor: active ? TacticalPalette.accent : "transparent",
          },
        ]}>
        <FontAwesome name="folder" size={16} color={active ? TacticalPalette.accent : TacticalPalette.boneMuted} />
        <Text
          style={[styles.navLabel, { color: active ? TacticalPalette.bone : TacticalPalette.boneMuted }]}
          numberOfLines={2}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <Text style={styles.brandKicker}>Team workspace</Text>
      <Text style={styles.brandTitle}>Team drive</Text>
      <Text style={styles.brandSub}>Shared workspace — encrypt with your unit keys.</Text>

      {isFileVault ? (
        <Pressable
          onPress={() => setNewOpen(true)}
          style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.92 }]}>
          <FontAwesome name="plus" size={16} color={TacticalPalette.matteBlack} style={{ marginRight: 8 }} />
          <Text style={styles.newBtnTx}>New</Text>
        </Pressable>
      ) : (
        <View style={{ height: 8 }} />
      )}

      <Modal visible={newOpen} transparent animationType="fade" onRequestClose={() => setNewOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setNewOpen(false)}>
          <View style={styles.menuSheet}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setNewOpen(false);
                onUploadFile();
              }}>
              <FontAwesome name="upload" size={16} color={TacticalPalette.bone} style={{ marginRight: 10 }} />
              <Text style={styles.menuItemTx}>Upload file</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setNewOpen(false);
                onNewFolder();
              }}>
              <FontAwesome name="folder" size={16} color={TacticalPalette.bone} style={{ marginRight: 10 }} />
              <Text style={styles.menuItemTx}>New folder</Text>
            </Pressable>
            <Pressable style={styles.menuCancel} onPress={() => setNewOpen(false)}>
              <Text style={styles.menuCancelTx}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.navList} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Files</Text>
        <Pressable
          onPress={() => {
            onSelectSection("private");
            onChangeNav("my");
          }}
          style={({ pressed }) => [
            styles.navRow,
            {
              backgroundColor:
                activeSection === "private" && driveNav === "my"
                  ? TacticalPalette.panel
                  : pressed
                    ? TacticalPalette.charcoal
                    : "transparent",
              borderLeftWidth: 3,
              borderLeftColor:
                activeSection === "private" && driveNav === "my" ? TacticalPalette.accent : "transparent",
            },
          ]}>
          <FontAwesome
            name="folder-open"
            size={16}
            color={
              activeSection === "private" && driveNav === "my" ? TacticalPalette.accent : TacticalPalette.boneMuted
            }
          />
          <Text
            style={[
              styles.navLabel,
              {
                color:
                  activeSection === "private" && driveNav === "my" ? TacticalPalette.bone : TacticalPalette.boneMuted,
              },
            ]}>
            Team drive
          </Text>
        </Pressable>
        {navRow("recent", "clock-o", "Recent", activeSection === "private" && driveNav === "recent", () => {
          onSelectSection("private");
          onChangeNav("recent");
        })}
        {navRow("trash", "trash", "Trash", activeSection === "private" && driveNav === "trash", () => {
          onSelectSection("private");
          onChangeNav("trash");
        })}
        <Pressable
          onPress={() => {
            onSelectSection("private");
            onChangeNav("cloud");
          }}
          style={({ pressed }) => [
            styles.navRow,
            {
              backgroundColor:
                activeSection === "private" && driveNav === "cloud"
                  ? TacticalPalette.panel
                  : pressed
                    ? TacticalPalette.charcoal
                    : "transparent",
              borderLeftWidth: 3,
              borderLeftColor:
                activeSection === "private" && driveNav === "cloud" ? TacticalPalette.accent : "transparent",
            },
          ]}>
          <FontAwesome
            name="cloud"
            size={16}
            color={activeSection === "private" && driveNav === "cloud" ? TacticalPalette.accent : TacticalPalette.boneMuted}
          />
          <Text
            style={[
              styles.navLabel,
              {
                color:
                  activeSection === "private" && driveNav === "cloud" ? TacticalPalette.bone : TacticalPalette.boneMuted,
              },
            ]}>
            Cloud (MinIO)
          </Text>
        </Pressable>

        <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Team folders</Text>
        <Text style={styles.sectionHint}>Operations reports (team key)</Text>
        {opsFolders.map(opsFolderRow)}

        <Pressable
          onPress={onOpenTeamHub}
          style={({ pressed }) => [
            styles.navRow,
            {
              marginTop: 14,
              paddingTop: 14,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: TacticalPalette.border,
              backgroundColor: pressed ? TacticalPalette.charcoal : "transparent",
              borderLeftWidth: 3,
              borderLeftColor: "transparent",
            },
          ]}>
          <FontAwesome name="users" size={16} color={TacticalPalette.coyote} />
          <Text style={[styles.navLabel, { color: TacticalPalette.bone }]}>Team hub</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 260,
    maxWidth: "100%",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.charcoal,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  brandKicker: {
    color: TacticalPalette.boneMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 4,
  },
  brandTitle: { color: TacticalPalette.bone, fontSize: 18, fontWeight: "900" },
  brandSub: {
    color: TacticalPalette.boneMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
    marginTop: 6,
  },
  sectionLabel: {
    color: TacticalPalette.boneMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  sectionHint: {
    color: TacticalPalette.boneMuted,
    fontSize: 11,
    marginBottom: 8,
    lineHeight: 15,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TacticalPalette.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  newBtnTx: { color: TacticalPalette.matteBlack, fontWeight: "900", fontSize: 15 },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  menuSheet: {
    backgroundColor: TacticalPalette.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    paddingVertical: 8,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemTx: { color: TacticalPalette.bone, fontWeight: "700", fontSize: 15 },
  menuCancel: { paddingVertical: 12, alignItems: "center" },
  menuCancelTx: { color: TacticalPalette.boneMuted, fontWeight: "700" },
  navList: { paddingTop: 12, gap: 4, paddingBottom: 24 },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  opsFolderRow: {
    paddingLeft: 12,
  },
  navLabel: { fontWeight: "700", fontSize: 13, flex: 1 },
});
