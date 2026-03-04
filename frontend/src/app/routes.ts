import { createBrowserRouter } from "react-router";
import { Root } from "./pages/Root";
import { Dashboard } from "./pages/Dashboard";
import { Nodes } from "./pages/Nodes";
// import { Services } from "./pages/Services";
import { Logs } from "./pages/Logs";
import { Simulation } from "./pages/Simulation";
import { NotFound } from "./pages/NotFound";
import { Login } from "./pages/Login";
import { ManageUsers } from "./pages/ManageUsers";
import { Mesh } from "./pages/Mesh";
import { RequireAdmin, RequireAuth } from "./auth/RouteGuards";
import { Profile } from "./pages/Profile";

export const router = createBrowserRouter([
  { path: "/login", Component: Login },
  {
    Component: RequireAuth,
    children: [
      {
        path: "/",
        Component: Root,
        children: [
          { index: true, Component: Dashboard },
          { path: "nodes", Component: Nodes },
          // { path: "services", Component: Services },
          { path: "logs", Component: Logs },
          { path: "simulation", Component: Simulation },
          { path: "mesh", Component: Mesh },
          { path: "profile", Component: Profile },
          {
            Component: RequireAdmin,
            children: [{ path: "users", Component: ManageUsers }],
          },
        ],
      },
    ],
  },
  { path: "*", Component: NotFound },
]);
