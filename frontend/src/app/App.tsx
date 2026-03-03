import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from "./auth/AuthContext";
import { SimulationBackgroundRunner } from "./sim/SimulationBackgroundRunner";

export default function App() {
  return (
    <AuthProvider>
      <SimulationBackgroundRunner />
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
