// This file is intentionally left as a redirect.
// Role-based navigation is in (player)/, (owner)/, and (admin)/ groups.
// This file kept to avoid breaking existing references.
import { Redirect } from "expo-router";
export default function TabsLayout() {
  return <Redirect href="/" />;
}
