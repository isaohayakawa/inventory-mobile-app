import React from 'react';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function TabIcon({ name, focusedName, color, focused }: { name: IconName; focusedName: IconName; color: ColorValue; focused: boolean }) {
  return <Ionicons name={focused ? focusedName : name} size={23} color={color} />;
}

const icon = (name: IconName, focusedName: IconName) => {
  const render = ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <TabIcon name={name} focusedName={focusedName} color={color} focused={focused} />
  );
  return render;
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory', tabBarIcon: icon('list-outline', 'list') }} />
      <Tabs.Screen
        name="new"
        options={{
          title: 'Add',
          tabBarButton: () => (
            <View style={styles.fabWrap}>
              <Pressable
                onPress={() => router.push('/add')}
                accessibilityRole="button"
                accessibilityLabel="Add item"
                style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="add" size={30} color={colors.onAccent} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="list" options={{ title: 'List', tabBarIcon: icon('cart-outline', 'cart') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings-outline', 'settings') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabWrap: { flex: 1, alignItems: 'center' },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
