import { Routes, Route } from 'react-router-dom';
import { Home } from './routes/Home';
import { Design } from './routes/Design';
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Home />} />
      <Route path="/interpreter" element={<Home />} />
      <Route path="/conversation" element={<Home />} />
      <Route path="/design" element={<Design />} />
    </Routes>
  );
}
