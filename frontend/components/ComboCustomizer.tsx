import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { API_URL } from "../constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";
import { addToCartGlobal } from "../stores/cartStore";

interface ComboOption {
  mappingId: string;
  dishId: string;
  name: string;
  description?: string;
  image?: string;
  surcharge: number;
  dishPrice: number;
  isDefault: boolean;
  sortOrder: number;
}

interface ComboGroup {
  comboGroupId: string;
  groupName: string;
  displayOrder: number;
  minSelection: number;
  maxSelection: number;
  isMultiSelect: boolean;
  options: ComboOption[];
}

interface ComboConfig {
  dishId: string;
  name: string;
  basePrice: number;
  description?: string;
  groups: ComboGroup[];
}

export default function ComboCustomizer({
  visible,
  onClose,
  dish,
  kitchenName,
  kitchenCode,
}: {
  visible: boolean;
  onClose: () => void;
  dish: any | null;
  kitchenName: string;
  kitchenCode: string;
}) {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ComboConfig | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [dishModifiers, setDishModifiers] = useState<any[]>([]);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);

  useEffect(() => {
    if (visible && dish) {
      loadComboConfig();
    } else {
      setConfig(null);
      setSelections({});
      setError(null);
      setDishModifiers([]);
      setSelectedModifierIds([]);
    }
  }, [visible, dish?.DishId]);

  const loadComboConfig = async () => {
    if (!dish) return;
    setLoading(true);
    setError(null);
    setDishModifiers([]);
    setSelectedModifierIds([]);
    try {
      const token = useAuthStore.getState().token;

      const [res, modRes] = await Promise.all([
        fetch(`${API_URL}/api/combo/config/${dish.DishId}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }),
        fetch(`${API_URL}/api/menu/modifiers/${dish.DishId}`).catch(() => null),
      ]);

      if (modRes && modRes.ok) {
        const modData = await modRes.json();
        if (Array.isArray(modData)) {
          setDishModifiers(modData);
        }
      }

      if (!res.ok) throw new Error("Failed to load combo options.");
      const payload = await res.json();
      if (payload.success && payload.data) {
        const rawGroups = payload.data.groups || [];
        const normalizedGroups = rawGroups.map((g: any) => {
          const parseBool = (v: any) =>
            v === true || v === 1 || String(v) === "1" || String(v) === "true";
          const isMulti =
            g.isMultiSelect !== undefined
              ? parseBool(g.isMultiSelect)
              : parseBool(g.IsMultiSelect);
          let maxSelect =
            g.maxSelection !== undefined
              ? Number(g.maxSelection)
              : Number(g.MaxSelection || 1);
          if (isMulti && maxSelect <= 1) {
            maxSelect = 999;
          }
          const minSelect =
            g.minSelection !== undefined
              ? Number(g.minSelection)
              : Number(g.MinSelection || 0);
          const comboGroupId = g.comboGroupId || g.ComboGroupId;
          const groupName = g.groupName || g.GroupName;
          const rawOptions = g.options || g.Options || [];

          const normalizedOptions = rawOptions.map((o: any) => ({
            mappingId: o.mappingId || o.MappingId,
            dishId: o.dishId || o.DishId,
            name: o.name || o.DishName || o.Name,
            description: o.description || o.DishDescription || o.Description,
            surcharge:
              o.surcharge !== undefined
                ? Number(o.surcharge)
                : Number(o.Surcharge || 0),
            dishPrice:
              o.dishPrice !== undefined
                ? Number(o.dishPrice)
                : Number(o.DishPrice || 0),
            isDefault:
              o.isDefault !== undefined
                ? parseBool(o.isDefault)
                : parseBool(o.IsDefault),
            sortOrder:
              o.sortOrder !== undefined
                ? Number(o.sortOrder)
                : Number(o.SortOrder || 0),
            KitchenTypeCode: o.KitchenTypeCode,
            KitchenTypeName: o.KitchenTypeName,
            PrinterIP: o.PrinterIP,
          }));

          return {
            comboGroupId,
            groupName,
            displayOrder: g.displayOrder || g.DisplayOrder || 0,
            minSelection: minSelect,
            maxSelection: maxSelect,
            isMultiSelect: isMulti,
            options: normalizedOptions,
          };
        });

        const normalizedConfig: ComboConfig = {
          dishId: payload.data.dishId || payload.data.DishId,
          name: payload.data.name || payload.data.Name,
          basePrice: parseFloat(
            payload.data.basePrice || payload.data.BasePrice || 0,
          ),
          description: payload.data.description || payload.data.Description,
          groups: normalizedGroups,
        };

        setConfig(normalizedConfig);

        // Auto-select defaults
        const initialSelections: Record<string, string[]> = {};
        normalizedGroups.forEach((group: ComboGroup) => {
          let defaults = group.options
            .filter((o) => o.isDefault)
            .map((o) => o.dishId);
          // Defensive check: If single-select, restrict defaults to 1 item
          if (!group.isMultiSelect || group.maxSelection === 1) {
            defaults = defaults.slice(0, 1);
          }
          // If minSelection > 0, no defaults are configured, and options exist, auto-select the first option
          if (
            defaults.length === 0 &&
            group.minSelection > 0 &&
            group.options &&
            group.options.length > 0
          ) {
            defaults = [group.options[0].dishId];
          }
          initialSelections[group.comboGroupId] = defaults;
        });
        setSelections(initialSelections);
      } else {
        throw new Error(payload.error || "Failed to load combo config.");
      }
    } catch (err: any) {
      console.error("Combo config fetch error:", err);
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = (
    groupId: string,
    option: ComboOption,
    isMulti: boolean,
    maxSelect: number,
  ) => {
    setError(null);
    setSelections((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(option.dishId)) {
        // Toggle off
        return {
          ...prev,
          [groupId]: current.filter((id) => id !== option.dishId),
        };
      } else {
        // Toggle on
        if (isMulti) {
          if (current.length >= maxSelect) {
            // Reached limit, replace oldest/first selection or reject
            return prev;
          }
          return {
            ...prev,
            [groupId]: [...current, option.dishId],
          };
        } else {
          // Single select: replace active choice
          return {
            ...prev,
            [groupId]: [option.dishId],
          };
        }
      }
    });
  };

  const handleToggleModifier = (modId: string) => {
    setSelectedModifierIds((prev) =>
      prev.includes(modId)
        ? prev.filter((id) => id !== modId)
        : [...prev, modId],
    );
  };

  const handleAddToCart = () => {
    if (!config || !dish) return;

    // Validate minimum selections
    for (const group of config.groups) {
      const selectedIds = selections[group.comboGroupId] || [];
      // Defensive check: If the group has no options in database, skip minimum validation
      const effectiveMin =
        group.options && group.options.length > 0 ? group.minSelection : 0;
      if (selectedIds.length < effectiveMin) {
        setError(
          `Please pick at least ${group.minSelection} choice(s) for "${group.groupName}"`,
        );
        return;
      }
    }

    // Build selected modifiers list
    const chosenModifiers = dishModifiers
      .filter((m) =>
        selectedModifierIds.includes(
          String(m.ModifierID || m.ModifierId || ""),
        ),
      )
      .map((m) => ({
        ModifierId: String(m.ModifierID || m.ModifierId || ""),
        ModifierName: m.ModifierName,
        Price: Number(m.Price || 0),
      }));

    // Build the selection details payload with surcharge calculations
    const chosenSelections = config.groups.map((group) => {
      const selectedIds = selections[group.comboGroupId] || [];
      const selectedOptions = group.options.filter((o) =>
        selectedIds.includes(o.dishId),
      );
      return {
        groupId: group.comboGroupId,
        groupName: group.groupName,
        items: selectedOptions.map((o) => ({
          dishId: o.dishId,
          name: o.name,
          surcharge: o.surcharge,
          dishPrice: o.dishPrice || 0,
          KitchenTypeCode: (o as any).KitchenTypeCode,
          KitchenTypeName: (o as any).KitchenTypeName,
          PrinterIP: (o as any).PrinterIP,
        })),
      };
    });

    // Sum surcharges and dish prices
    let totalSurcharge = 0;
    chosenSelections.forEach((grp) => {
      grp.items.forEach((opt) => {
        totalSurcharge += opt.surcharge + (opt.dishPrice || 0);
      });
    });

    const modifierPriceTotal = chosenModifiers.reduce(
      (sum, m) => sum + m.Price,
      0,
    );
    const finalPrice = config.basePrice + totalSurcharge + modifierPriceTotal;

    addToCartGlobal({
      id: dish.DishId,
      name: dish.Name,
      price: finalPrice,
      basePrice: config.basePrice,
      isCombo: true,
      comboSelections: chosenSelections,
      modifiers: chosenModifiers,
      categoryName: kitchenName,
      KitchenTypeName: dish.KitchenTypeName || kitchenName,
      PrinterIP: dish.PrinterIP,
      KitchenTypeCode: dish.KitchenTypeCode || kitchenCode,
      isServiceCharge: dish.isServiceCharge,
      IsOpenItem: dish.IsOpenItem,
    } as any);

    onClose();
  };

  const handleAddDirectly = () => {
    if (!dish) return;

    const chosenModifiers = dishModifiers
      .filter((m) =>
        selectedModifierIds.includes(
          String(m.ModifierID || m.ModifierId || ""),
        ),
      )
      .map((m) => ({
        ModifierId: String(m.ModifierID || m.ModifierId || ""),
        ModifierName: m.ModifierName,
        Price: Number(m.Price || 0),
      }));

    const modifierPriceTotal = chosenModifiers.reduce(
      (sum, m) => sum + m.Price,
      0,
    );
    const finalPrice = (dish.Price || 0) + modifierPriceTotal;

    addToCartGlobal({
      id: dish.DishId,
      name: dish.Name,
      price: finalPrice,
      modifiers: chosenModifiers,
      categoryName: kitchenName,
      KitchenTypeName: dish.KitchenTypeName || kitchenName,
      PrinterIP: dish.PrinterIP,
      KitchenTypeCode: dish.KitchenTypeCode || kitchenCode,
      isServiceCharge: dish.isServiceCharge,
      IsOpenItem: dish.IsOpenItem,
    } as any);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="fast-food-outline"
                  size={18}
                  color={Theme.primary}
                />
              </View>
              <Text style={styles.title} numberOfLines={1}>
                Customize {dish?.Name || "Combo"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Theme.primary} />
              <Text style={styles.loadingText}>Loading combo options...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Ionicons
                name="alert-circle-outline"
                size={48}
                color={Theme.danger}
              />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={loadComboConfig}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={config?.groups || []}
              keyExtractor={(item) => item.comboGroupId}
              contentContainerStyle={styles.body}
              renderItem={({ item: group }) => {
                const selectedIds = selections[group.comboGroupId] || [];
                return (
                  <View style={styles.groupSection}>
                    <View style={styles.groupHeader}>
                      <Text style={styles.groupTitle}>{group.groupName}</Text>
                      <Text style={styles.groupRules}>
                        (Pick{" "}
                        {group.minSelection === group.maxSelection
                          ? group.minSelection
                          : `${group.minSelection}-${group.maxSelection}`}
                        )
                      </Text>
                    </View>
                    <View style={styles.optionsGrid}>
                      {group.options.map((option) => {
                        const isSelected = selectedIds.includes(option.dishId);
                        return (
                          <TouchableOpacity
                            key={option.mappingId}
                            style={[
                              styles.optionCard,
                              isSelected && styles.optionCardSelected,
                            ]}
                            onPress={() =>
                              handleSelectOption(
                                group.comboGroupId,
                                option,
                                group.isMultiSelect,
                                group.maxSelection,
                              )
                            }
                          >
                            <Text
                              style={[
                                styles.optionName,
                                isSelected && styles.optionTextSelected,
                              ]}
                            >
                              {option.name}
                            </Text>
                            {(option.surcharge > 0 || option.dishPrice > 0) && (
                              <Text
                                style={[
                                  styles.optionSurcharge,
                                  isSelected && styles.optionTextSelected,
                                ]}
                              >
                                +$
                                {(
                                  option.surcharge + (option.dishPrice || 0)
                                ).toFixed(2)}
                              </Text>
                            )}
                            {isSelected && (
                              <View style={styles.checkmarkWrap}>
                                <Ionicons
                                  name="checkmark-circle"
                                  size={18}
                                  color={Theme.primary}
                                />
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              }}
              ListFooterComponent={(() => {
                let currentTotal = config?.basePrice || 0;
                config?.groups?.forEach((group) => {
                  const selectedIds = selections[group.comboGroupId] || [];
                  const selectedOptions = group.options.filter((o) =>
                    selectedIds.includes(o.dishId),
                  );
                  selectedOptions.forEach((opt) => {
                    currentTotal += (opt.surcharge || 0) + (opt.dishPrice || 0);
                  });
                });

                const chosenModifiers = dishModifiers.filter((m) =>
                  selectedModifierIds.includes(
                    String(m.ModifierID || m.ModifierId || ""),
                  ),
                );
                const modifierPriceTotal = chosenModifiers.reduce(
                  (sum, m) => sum + Number(m.Price || 0),
                  0,
                );
                currentTotal += modifierPriceTotal;

                return (
                  <View style={styles.footer}>
                    {dishModifiers.length > 0 && (
                      <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.groupTitle, { marginBottom: 12 }]}>
                          Add Modifiers (Multiple Selection)
                        </Text>
                        <View style={{ gap: 8 }}>
                          {dishModifiers.map((m) => {
                            const isSelected = selectedModifierIds.includes(
                              String(m.ModifierID || m.ModifierId || ""),
                            );
                            return (
                              <TouchableOpacity
                                key={m.ModifierID}
                                style={[
                                  styles.modifierRow,
                                  isSelected && styles.modifierRowSelected,
                                ]}
                                onPress={() =>
                                  handleToggleModifier(
                                    String(m.ModifierID || m.ModifierId || ""),
                                  )
                                }
                                activeOpacity={0.7}
                              >
                                <View
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 10,
                                  }}
                                >
                                  <Ionicons
                                    name={
                                      isSelected ? "checkbox" : "square-outline"
                                    }
                                    size={20}
                                    color={
                                      isSelected ? Theme.primary : "#7F8C8D"
                                    }
                                  />
                                  <Text style={styles.modifierName}>
                                    {m.ModifierName}
                                  </Text>
                                </View>
                                {m.Price > 0 && (
                                  <Text style={styles.modifierPrice}>
                                    +${Number(m.Price).toFixed(2)}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {error ? (
                      <Text
                        style={{
                          color: Theme.danger,
                          textAlign: "center",
                          marginBottom: 12,
                          fontFamily: Fonts.medium,
                          fontSize: 13,
                        }}
                      >
                        {error}
                      </Text>
                    ) : null}
                    <TouchableOpacity
                      style={styles.confirmButton}
                      onPress={handleAddToCart}
                    >
                      <Text style={styles.confirmButtonText}>
                        Add Combo to Cart - ${currentTotal.toFixed(2)}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.confirmButton,
                        { backgroundColor: "#ECEFF1", marginTop: 10 },
                      ]}
                      onPress={handleAddDirectly}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.confirmButtonText, { color: "#37474F" }]}
                      >
                        Add Base Combo Directly (Skip Selections)
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    width: "80%",
    maxWidth: 650,
    maxHeight: "85%",
    backgroundColor: Theme.bgCard || "#FFF",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border || "#E5E5E5",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.primaryLight || "#FFF5EB",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  title: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary || "#1E1E1E",
  },
  closeBtn: {
    padding: 4,
  },
  loadingContainer: {
    padding: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary || "#666",
  },
  errorContainer: {
    padding: 40,
    alignItems: "center",
  },
  errorText: {
    marginTop: 10,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.danger || "#D32F2F",
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#FFF",
    fontFamily: Fonts.bold,
  },
  body: {
    padding: 20,
  },
  groupSection: {
    marginBottom: 24,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  groupTitle: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#2C3E50",
    letterSpacing: 0.3,
  },
  groupRules: {
    marginLeft: 8,
    fontSize: 11,
    fontFamily: Fonts.semiBold,
    color: "#95A5A6",
    backgroundColor: "#F2F4F4",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    textTransform: "uppercase",
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  optionCard: {
    width: 125,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#EAECEE",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    // Premium soft card shadows
    shadowColor: "#17202A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  optionCardSelected: {
    borderColor: Theme.primary,
    backgroundColor: "#FFF5EB",
    shadowColor: Theme.primary,
    shadowOpacity: 0.08,
  },
  optionName: {
    fontSize: 13,
    fontFamily: Fonts.semiBold,
    color: "#2C3E50",
    textAlign: "center",
    paddingHorizontal: 12,
  },
  optionSurcharge: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
    marginTop: 4,
    backgroundColor: "#FFEEDB",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  optionTextSelected: {
    color: Theme.primary,
  },
  checkmarkWrap: {
    position: "absolute",
    top: -9,
    right: -9,
    zIndex: 10,
  },
  footer: {
    marginTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#EAECEE",
    paddingTop: 20,
    paddingBottom: 10,
  },
  confirmButton: {
    backgroundColor: Theme.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  confirmButtonText: {
    color: "#FFF",
    fontFamily: Fonts.bold,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  modifierRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    borderColor: "#EAECEE",
    borderRadius: 10,
    backgroundColor: "#FAF9F6",
  },
  modifierRowSelected: {
    borderColor: Theme.primary,
    backgroundColor: "#FFF5EB",
  },
  modifierName: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: "#2C3E50",
  },
  modifierPrice: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
});
