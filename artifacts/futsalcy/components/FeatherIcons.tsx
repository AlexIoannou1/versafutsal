import createIconSet from "@expo/vector-icons/build/createIconSet";
import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json";

// Use a font family name that Expo Go has NOT pre-registered.
// Expo Go SDK 54 pre-loads '@expo/vector-icons' fonts under their default names
// (e.g. 'feather'). expo-font's loadAsync skips loading when isLoaded() returns
// true, which it does for the pre-registered 'feather' name — even though the
// pre-bundled version may be an older/mismatched build. Using a unique name forces
// expo-font to actually download and register the correct TTF from this bundle,
// which fixes the boxed-X glyph rendering on Android Expo Go.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontAsset = require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf");

const FeatherIcons = createIconSet(glyphMap, "FeatherIcons", fontAsset);

export default FeatherIcons;
export type FeatherIconName = keyof typeof glyphMap;
