import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        pink: "rgb(var(--rgb-pink) / <alpha-value>)",
        blue: "rgb(var(--rgb-blue) / <alpha-value>)",
        yellow: "rgb(var(--rgb-yellow) / <alpha-value>)",
        teal: "rgb(var(--rgb-teal) / <alpha-value>)",
        purple: "rgb(var(--rgb-purple) / <alpha-value>)",
        danger: "rgb(var(--rgb-danger) / <alpha-value>)",
        foreground: "rgb(var(--rgb-foreground) / <alpha-value>)",
        muted: "rgb(var(--rgb-muted) / <alpha-value>)",
        surface: "rgb(var(--rgb-surface) / <alpha-value>)"
      },
      fontFamily: {
        sans: ["Arial", "Helvetica", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
