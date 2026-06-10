import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        steel: {
          50: "#f5f7f8",
          100: "#e8ecef",
          500: "#6c7a86",
          800: "#26333f",
          900: "#18222c"
        },
        safety: {
          400: "#f4c542",
          500: "#e7a700",
          600: "#bf8300"
        },
        workshop: {
          500: "#2d7d71",
          700: "#1f5b54"
        }
      },
      boxShadow: {
        panel: "0 10px 30px rgba(24, 34, 44, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
