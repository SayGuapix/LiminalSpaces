// ==========================================
// ThemeContext.tsx - CONTROL DE TEMA CLARO/OSCURO
// ==========================================
// Maneja el tema (claro u oscuro), si el sistema pide reducir el movimiento y si el
// equipo parece lento (menos partículas en el cielo).

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { detectLowEndDevice, prefersReducedMotion } from "@/lib/devicePerformance";

interface ThemeContextType {
  theme: "light" | "dark";
  toggleTheme: () => void;
  // true si el usuario pidió "reducir movimiento" en su sistema: el cielo queda quieto.
  reducedMotion: boolean;
  // true si el equipo parece lento (pistas del hardware).
  lowPerformance: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readSavedTheme(): "light" | "dark" | null {
  try {
    const saved = localStorage.getItem("theme");
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // El tema elegido antes o, en la primera visita, el del sistema.
  const [theme, setTheme] = useState<"light" | "dark">(
    () => readSavedTheme() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [lowPerformance] = useState(detectLowEndDevice);

  useEffect(() => {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Sin almacenamiento la elección dura solo esta visita.
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Escucha si el usuario cambia "reducir movimiento" en su sistema mientras juega.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const toggleTheme = () => setTheme((prev) => (prev === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, reducedMotion, lowPerformance }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemeContext must be used within a ThemeProvider");
  }
  return context;
}
