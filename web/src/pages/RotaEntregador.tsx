// Página do entregador, aberta pelo link da rota. Não usa login: vale a chave que vem depois do "#".
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { lerEmBase64 } from '../api'
import { brl, formasPagamento, telefoneBr } from '../format'
import type { RotaDoEntregador } from '../types'

const situacoes: Record<string, string> = { PENDENTE: 'Aguardando', EM_ROTA: 'Em rota', ENTREGUE: 'Entregue', FALHOU: 'Não entregue' }

export function RotaEntregador() {
  const { id } = useParams()
  const chave = new URLSearchParams(window.location.hash.slice(1)).get('chave') ?? ''
  const [rota, setRota] = useState<RotaDoEntregador | null>(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aberta, setAberta] = useState<number | null>(null)
  const [recebedor, setRecebedor] = useState('')
  const [observacao, setObservacao] = useState('')

  async function chamar(caminho = '', corpo?: unknown) {
    const res = await fetch(`/api/entregador/rotas/${id}${caminho}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Rota-Token': chave },
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    const dados = await res.json().catch(() => null)
    if (!res.ok) throw new Error(dados?.erro ?? 'Link indisponível ou expirado.')
    return dados as RotaDoEntregador
  }

  // `manterCampos`: anexar um comprovante não apaga o que já foi digitado para concluir a entrega.
  async function executar(operacao: () => Promise<RotaDoEntregador>, manterCampos = false) {
    setOcupado(true)
    setErro('')
    try {
      setRota(await operacao())
      if (manterCampos) return
      setRecebedor('')
      setObservacao('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.')
    } finally {
      setOcupado(false)
    }
  }

  useEffect(() => {
    void executar(() => chamar())
    // Carrega uma vez ao abrir o link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const registrar = (entregaId: number, status: 'EM_ROTA' | 'ENTREGUE' | 'FALHOU') =>
    executar(() => chamar(`/entregas/${entregaId}`, { status, recebedor, observacao }))

  // Foto da entrega ou do comprovante assinado; no celular, o seletor oferece a câmera.
  const anexar = (entregaId: number, arquivo: File | undefined) =>
    arquivo && executar(async () => chamar(`/entregas/${entregaId}/documentos`, { nome: arquivo.name, conteudo: await lerEmBase64(arquivo) }), true)

  return (
    <main className="entregador">
      <header>
        <small>ENTREGAS</small>
        <h1>{rota?.nome ?? 'Rota de entrega'}</h1>
        {rota && (
          <>
            <p>
              {new Date(rota.data).toLocaleDateString('pt-BR')} · {rota.entregas.filter((e) => e.status === 'ENTREGUE').length}/{rota.entregas.length} entregues
            </p>
            <p>Saída: {rota.pontoSaida}</p>
            <small>Link válido até {new Date(rota.expiraEm).toLocaleString('pt-BR')}</small>
          </>
        )}
        <button type="button" className="botao" disabled={ocupado} onClick={() => void executar(() => chamar())}>
          Atualizar rota
        </button>
      </header>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {ocupado && <p role="status" className="aviso">Aguarde…</p>}

      {rota?.entregas.map((e, i) => {
        const digitos = (e.telefone ?? '').replace(/\D/g, '')
        const fone = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos
        return (
          <article key={e.id} className="painel parada">
            <button type="button" className="parada-topo" onClick={() => setAberta(aberta === e.id ? null : e.id)} aria-expanded={aberta === e.id}>
              <strong>{i + 1}. {e.destinatario}</strong>
              <span>Pedido nº {e.pedidoNumero} · {situacoes[e.status] ?? e.status}</span>
              <span>{e.endereco}</span>
            </button>
            {aberta === e.id && (
              <section className="parada-detalhe">
                <p><strong>Telefone:</strong> {telefoneBr(e.telefone) ?? 'Não informado'}</p>
                <ul>
                  {e.itens.map((item, n) => (
                    <li key={n}>{item.quantidade} {item.unidade} · {item.produto}</li>
                  ))}
                </ul>
                <p><strong>Pagamento combinado:</strong> {e.pagamento ? (formasPagamento[e.pagamento] ?? e.pagamento) : 'Não informado'}</p>
                <p><strong>Valor do pedido:</strong> {brl(e.valorPedido)}</p>
                <small className="texto-suave">O valor do pedido não informa quanto falta pagar. Confirme a cobrança com a empresa.</small>
                {(e.inicioRecebimento || e.fimRecebimento) && (
                  <p><strong>Horário de recebimento:</strong> {e.inicioRecebimento ?? '—'} às {e.fimRecebimento ?? '—'}</p>
                )}
                {e.observacaoEntrega && <p><strong>Observação da entrega:</strong> {e.observacaoEntrega}</p>}
                {e.observacaoVenda && <p><strong>Observação da venda:</strong> {e.observacaoVenda}</p>}
                {e.status === 'ENTREGUE' && <p><strong>Recebido por:</strong> {e.recebedor}</p>}
                {e.status === 'FALHOU' && <p className="texto-ruim"><strong>Não entregue:</strong> {e.motivoFalha}</p>}
                <nav className="parada-atalhos">
                  <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.endereco)}`}>Navegar</a>
                  {fone && <a href={`tel:+${fone}`}>Ligar</a>}
                  {fone && <a target="_blank" rel="noreferrer" href={`https://wa.me/${fone}`}>WhatsApp</a>}
                </nav>

                {e.documentos.length > 0 && (
                  <p>
                    <strong>Comprovantes enviados:</strong> {e.documentos.map((d) => d.nome).join(', ')}
                  </p>
                )}
                {e.status !== 'PENDENTE' && (
                  <label className="campo">
                    <span>{ocupado ? 'Enviando…' : 'Anexar foto ou comprovante (imagem ou PDF)'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      disabled={ocupado}
                      onChange={(ev) => {
                        void anexar(e.id, ev.target.files?.[0])
                        ev.target.value = ''
                      }}
                    />
                  </label>
                )}
                {e.status === 'PENDENTE' && (
                  <button type="button" className="botao botao-primario" disabled={ocupado} onClick={() => void registrar(e.id, 'EM_ROTA')}>
                    Iniciar entrega
                  </button>
                )}
                {e.status === 'EM_ROTA' && (
                  <>
                    <label className="campo">
                      <span>Quem recebeu (para confirmar a entrega)</span>
                      <input value={recebedor} onChange={(ev) => setRecebedor(ev.target.value)} />
                    </label>
                    <label className="campo">
                      <span>Observação ou motivo (obrigatório se não foi possível entregar)</span>
                      <input value={observacao} onChange={(ev) => setObservacao(ev.target.value)} />
                    </label>
                    <button type="button" className="botao botao-primario" disabled={ocupado || recebedor.trim().length < 2} onClick={() => void registrar(e.id, 'ENTREGUE')}>
                      Confirmar entrega
                    </button>
                    <button type="button" className="botao botao-perigo" disabled={ocupado || observacao.trim().length < 2} onClick={() => void registrar(e.id, 'FALHOU')}>
                      Não foi possível entregar
                    </button>
                  </>
                )}
              </section>
            )}
          </article>
        )
      })}
    </main>
  )
}
