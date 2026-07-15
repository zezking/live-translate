import { Routes, Route } from 'react-router-dom';
import { Home } from './routes/Home';
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Home />} />
      <Route path="/interpreter" element={<Home />} />
      <Route path="/conversation" element={<Home />} />
    </Routes>
  );
}
