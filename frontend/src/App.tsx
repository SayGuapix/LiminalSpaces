import { ThemeProvider } from "@/contexts/ThemeContext";
import World3D from "@/components/world3d/World3D";

// La página entra directamente al mundo 3D.
const App = () => (
  <ThemeProvider>
    <World3D />
  </ThemeProvider>
);

export default App;
