import { Redirect } from 'expo-router';

/** Placeholder route for the center "+" tab button, which opens /add as a modal. */
export default function NewPlaceholder() {
  return <Redirect href="/add" />;
}
