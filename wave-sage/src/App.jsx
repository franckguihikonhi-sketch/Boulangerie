import { useState } from 'react';
import { useStore, useDbStatus } from './lib/useStore';
import Layout from './components/Layout';
import Import from './pages/Import';
import Regles from './pages/Regles';
import Parametres from './pages/Parametres';
import Plan from './pages/Plan';
import Historique from './pages/Historique';
import Apropos from './pages/Apropos';

export default function App() {
  const [page, setPage] = useState('import');
  const store = useStore();
  const { backend } = useDbStatus();

  return (
    <Layout page={page} setPage={setPage} backend={backend}>
      {page === 'import' && <Import store={store} />}
      {page === 'historique' && <Historique store={store} />}
      {page === 'regles' && <Regles store={store} />}
      {page === 'plan' && <Plan store={store} />}
      {page === 'parametres' && <Parametres store={store} backend={backend} />}
      {page === 'apropos' && <Apropos />}
    </Layout>
  );
}
