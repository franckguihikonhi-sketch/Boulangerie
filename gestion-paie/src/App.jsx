import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Bulletins from './pages/Bulletins';
import LivrePaie from './pages/LivrePaie';
import Cotisations from './pages/Cotisations';
import Impots from './pages/Impots';
import Simulateur from './pages/Simulateur';
import SoldeToutCompte from './pages/SoldeToutCompte';
import Historique from './pages/Historique';
import Parametres from './pages/Parametres';
import About from './pages/About';

function RequireAuth({ children }) {
  const { user, authReady } = useAuth();
  // Tant que la restauration d'une éventuelle session Supabase réelle n'est
  // pas confirmée (asynchrone, voir auth.jsx), on n'affiche rien plutôt que
  // de rediriger à tort vers /login quelqu'un déjà connecté.
  if (!authReady) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/salaries" element={<Employees />} />
        <Route path="/bulletins" element={<Bulletins />} />
        <Route path="/livre-de-paie" element={<LivrePaie />} />
        <Route path="/etat-cotisations" element={<Cotisations />} />
        <Route path="/etat-impots" element={<Impots />} />
        <Route path="/simulateur" element={<Simulateur />} />
        <Route path="/solde-tout-compte" element={<SoldeToutCompte />} />
        <Route path="/historique" element={<Historique />} />
        <Route path="/parametres" element={<Parametres />} />
        <Route path="/a-propos" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
