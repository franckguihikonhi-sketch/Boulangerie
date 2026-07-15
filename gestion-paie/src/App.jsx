import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Bulletins from './pages/Bulletins';
import LivrePaie from './pages/LivrePaie';
import Cotisations from './pages/Cotisations';
import Parametres from './pages/Parametres';
import About from './pages/About';

function RequireAuth({ children }) {
  const { user } = useAuth();
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
        <Route path="/parametres" element={<Parametres />} />
        <Route path="/a-propos" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
