import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProvedorSessao } from './auth'
import { Layout } from './Layout'
import { Entrar } from './pages/Entrar'
import { Inicio } from './pages/Inicio'
import { Pessoas } from './pages/Pessoas'
import { Produtos } from './pages/Produtos'
import { Dashboards } from './pages/Dashboards'
import { Devolucoes } from './pages/Devolucoes'
import { Entradas } from './pages/Entradas'
import { Pedidos } from './pages/Pedidos'
import { Entregas } from './pages/Entregas'
import { Financeiro } from './pages/Financeiro'
import { Promocoes } from './pages/Promocoes'
import { Relatorios } from './pages/Relatorios'
import { RotaEntregador } from './pages/RotaEntregador'
import { Usuarios } from './pages/Usuarios'
import { Avisos } from './avisos'
import { useTabelasEmCartoes } from './tabelas'
// A fonte vai junto no pacote do sistema, sem depender de serviço externo.
import '@fontsource-variable/inter'
import './styles.css'

// Fica na raiz porque vale para todas as telas, inclusive a do entregador, que não usa o Layout.
function TabelasEmCartoes() {
  useTabelasEmCartoes()
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TabelasEmCartoes />
    <Avisos />
    <BrowserRouter>
      <ProvedorSessao>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/rota/:id" element={<RotaEntregador />} />
          <Route element={<Layout />}>
            <Route index element={<Inicio />} />
            <Route path="pessoas" element={<Pessoas />} />
            <Route path="produtos" element={<Produtos />} />
            <Route path="entradas" element={<Entradas />} />
            <Route path="pedidos" element={<Pedidos />} />
            <Route path="devolucoes" element={<Devolucoes />} />
            <Route path="entregas" element={<Entregas />} />
            <Route path="financeiro" element={<Financeiro />} />
            <Route path="promocoes" element={<Promocoes />} />
            <Route path="dashboards" element={<Dashboards />} />
            <Route path="relatorios" element={<Relatorios />} />
            <Route path="usuarios" element={<Usuarios />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ProvedorSessao>
    </BrowserRouter>
  </StrictMode>,
)
