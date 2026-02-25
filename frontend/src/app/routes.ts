import { createBrowserRouter } from "react-router";
import { Root } from "./pages/Root";
import { Dashboard } from "./pages/Dashboard";
import { Nodes } from "./pages/Nodes";
import { Services } from "./pages/Services";
import { Logs } from "./pages/Logs";
import { Simulation } from "./pages/Simulation";
import { NotFound } from "./pages/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "nodes", Component: Nodes },
      { path: "services", Component: Services },
      { path: "logs", Component: Logs },
      { path: "simulation", Component: Simulation },
    ],
  },
  { path: "*", Component: NotFound },
]);
