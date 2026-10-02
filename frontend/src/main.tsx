// Mounts the host UI; shared state and preview inspection do not belong to the React entry point.
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(<App />);
