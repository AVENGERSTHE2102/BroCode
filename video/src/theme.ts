import { loadFont as loadDisplay } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const display = loadDisplay("normal", { weights: ["400", "600", "800"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;
export const emoji = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';

export const C = {
  bg: "#0b0d0c",
  bg2: "#121613",
  panel: "#161a17",
  line: "#2a3029",
  text: "#f3f1ea",
  muted: "#9aa39a",
  sage: "#5c7053", // Waypoint's own accent (--purple/accent token), the one accent on a dark base
  sageSoft: "#7d9472",
  sageDeep: "#42634e",
  green: "#3ddc84",
  red: "#ff5c61",
  amber: "#e0a85c",
};

export const FPS = 30;
export const s = (seconds: number) => Math.round(seconds * FPS);
