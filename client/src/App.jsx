import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import HostRoom from './pages/HostRoom';
import ListenerRoom from './pages/ListenerRoom';
import JoinPage from './pages/JoinPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/host/:roomId" element={<HostRoom />} />
      <Route path="/room/:code" element={<JoinPage />} />
      <Route path="/listen/:roomId" element={<ListenerRoom />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
