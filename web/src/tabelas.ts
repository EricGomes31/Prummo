import { useEffect } from 'react'

// No celular, tabelas largas viram uma lista de cartões (regras em styles.css, classe em-cartoes).
// Para cada célula mostrar o título da sua coluna, este gancho copia o texto do cabeçalho para o
// atributo data-rotulo das células. Ele observa a página inteira, então vale para qualquer tela
// e para tabelas que aparecem depois, dentro de janelas, sem nada a fazer em cada uma.
const COLUNAS_MINIMAS = 4

function rotular(raiz: ParentNode) {
  for (const tabela of raiz.querySelectorAll('table')) {
    const titulos = [...tabela.querySelectorAll(':scope > thead > tr > th')].map((th) =>
      (th.textContent ?? '').replace(/[↑↓↕]/g, '').trim(),
    )
    // Tabelas pequenas cabem na tela do celular como tabela mesmo.
    tabela.classList.toggle('em-cartoes', titulos.length >= COLUNAS_MINIMAS)
    if (titulos.length < COLUNAS_MINIMAS) continue
    for (const linha of tabela.querySelectorAll(':scope > tbody > tr')) {
      Array.from(linha.children).forEach((celula, i) => {
        const rotulo = titulos[i] ?? ''
        if (celula.getAttribute('data-rotulo') !== rotulo) celula.setAttribute('data-rotulo', rotulo)
        // Célula sem valor (vazia ou só um travessão) some do cartão, para ele não ficar comprido à toa.
        // Célula com campo de formulário nunca some, mesmo sem texto.
        const semValor = !celula.querySelector('input, select, textarea, button') && /^[—-]?$/.test((celula.textContent ?? '').trim())
        celula.toggleAttribute('data-sem-valor', semValor)
      })
    }
  }
}

export function useTabelasEmCartoes() {
  useEffect(() => {
    let agendado = 0
    const aplicar = () => {
      cancelAnimationFrame(agendado)
      agendado = requestAnimationFrame(() => rotular(document.body))
    }
    aplicar()
    // Interessam mudanças na estrutura e no texto; alterar os atributos não dispara o observador de novo.
    const observador = new MutationObserver(aplicar)
    observador.observe(document.body, { childList: true, characterData: true, subtree: true })
    return () => {
      cancelAnimationFrame(agendado)
      observador.disconnect()
    }
  }, [])
}
