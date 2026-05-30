/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      keyframes: {
        "pop-in": {
          "0%": { transform: "scale(0.5)", opacity: "0" },
          "60%": { transform: "scale(1.1)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", boxShadow: "0 0 0 0 rgba(255,255,255,0.5)" },
          "70%": { transform: "scale(1)", boxShadow: "0 0 0 24px rgba(255,255,255,0)" },
          "100%": { transform: "scale(0.95)", boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        },
        "count-bounce": {
          "0%": { transform: "scale(0.3)", opacity: "0" },
          "50%": { transform: "scale(1.2)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "pop-in": "pop-in 0.4s ease-out",
        "pulse-ring": "pulse-ring 1.5s ease-out infinite",
        "count-bounce": "count-bounce 1s ease-out",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
