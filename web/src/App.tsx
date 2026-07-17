import { Routes, Route } from 'react-router-dom';
import { Home } from './routes/Home';
import { Design } from './routes/Design';
import { Conversation } from './routes/Conversation';
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Home />} />
      <Route path="/interpreter" element={<Home />} />
      <Route path="/conversation" element={<Conversation />} />
      <Route path="/design" element={<Design />} />
    </Routes>
  );
}
