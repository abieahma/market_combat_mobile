import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const palette = {
  light: { bg: '#F4F5F7', card: '#FFFFFF', text: '#14161A', muted: '#6B7280', accent: '#2F6FEB', accentText: '#FFFFFF' },
  dark: { bg: '#0F1115', card: '#1A1D23', text: '#F2F3F5', muted: '#9AA1AC', accent: '#4C8DFF', accentText: '#0B1020' },
};

const platformLabel: Record<string, string> = {
  android: 'Android · Expo Go',
  ios: 'iOS · Expo Go',
  web: 'Веб-предпросмотр',
};

export default function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const c = palette[scheme];
  const [count, setCount] = useState(0);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.badge, { color: c.muted }]}>{platformLabel[Platform.OS] ?? Platform.OS}</Text>
          <Text style={[styles.title, { color: c.text }]}>Заготовка готова</Text>
          <Text style={[styles.body, { color: c.muted }]}>
            Правки из чата попадают сюда автоматически: в Expo Go на телефоне и в предпросмотр.
          </Text>

          <Pressable
            onPress={() => setCount((n) => n + 1)}
            style={({ pressed }) => [styles.button, { backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.buttonText, { color: c.accentText }]}>Нажато: {count}</Text>
          </Pressable>
        </View>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    padding: 24,
    gap: 12,
  },
  badge: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
