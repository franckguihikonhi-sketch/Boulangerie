import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import DemoEntry from './pages/DemoEntry';
import Dashboard from './pages/Dashboard';
import Devis from './pages/Devis';
import Payments from './pages/Payments';
import Articles from './pages/Articles';
import Profile from './pages/Profile';
import About from './pages/About';

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Le catalogue Articles est réservé au Responsable (admin) ; un commercial y
// est redirigé vers le tableau de bord.
function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/demo" element={<DemoEntry />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/devis" element={<Devis />} />
        <Route path="/paiements" element={<Payments />} />
        <Route path="/articles" element={<RequireAdmin><Articles /></RequireAdmin>} />
        <Route path="/profil" element={<Profile />} />
        <Route path="/a-propos" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
