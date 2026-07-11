import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Ingredients from './pages/Ingredients';
import Products from './pages/Products';
import Purchases from './pages/Purchases';
import Production from './pages/Production';
import Sales from './pages/Sales';
import Stock from './pages/Stock';
import History from './pages/History';
import Reports from './pages/Reports';
import About from './pages/About';
import DemoEntry from './pages/DemoEntry';

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Rôle Opérateur : accès limité à Ventes et Production, sans visibilité sur
// les coûts d'achat ni les marges (section 5.8).
function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/ventes" replace />;
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
        <Route path="/" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
        <Route path="/ingredients" element={<RequireAdmin><Ingredients /></RequireAdmin>} />
        <Route path="/produits" element={<RequireAdmin><Products /></RequireAdmin>} />
        <Route path="/achats" element={<RequireAdmin><Purchases /></RequireAdmin>} />
        <Route path="/production" element={<Production />} />
        <Route path="/ventes" element={<Sales />} />
        <Route path="/stocks" element={<RequireAdmin><Stock /></RequireAdmin>} />
        <Route path="/historique" element={<RequireAdmin><History /></RequireAdmin>} />
        <Route path="/rapports" element={<RequireAdmin><Reports /></RequireAdmin>} />
        <Route path="/a-propos" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
