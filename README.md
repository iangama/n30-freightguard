N30 FreightGuard

Este projeto é um motor de decisão para operações de frete. Ele não é apenas uma API nem apenas uma interface visual: ele é um produto que responde a uma pergunta concreta do mundo real — dado um frete agora, com uma origem, um destino, um SLA e um contexto climático, essa operação deve ser autorizada, autorizada com custo adicional ou bloqueada?

O FreightGuard foi pensado para tornar explícito algo que normalmente fica implícito em sistemas de logística: decisões têm custo, decisões dependem de contexto externo e decisões precisam ser explicáveis depois que já foram tomadas. Aqui, nenhuma decisão acontece de forma síncrona na API ou na UI. A API apenas aceita comandos. A interface apenas observa. O poder de decidir está concentrado em um worker assíncrono.

Do ponto de vista de produto, o fluxo é simples de entender. O usuário abre a interface, clica no mapa para definir origem e destino e envia a operação. A API aceita o comando, mas não decide nada naquele momento. Em segundo plano, o worker processa a operação, consulta clima real usando OpenWeatherMap, aplica regras de risco e orçamento e grava uma decisão definitiva. Essa decisão é persistida junto com o clima utilizado, data, custo e orçamento restante. A interface então passa a exibir esse resultado de forma clara e auditável.

O ponto central do FreightGuard não é apenas a decisão final, mas a capacidade de provar como ela foi produzida. O clima utilizado na decisão não é recalculado depois nem inferido: ele é persistido como evidência. Cada decisão gera um evento em um ledger com encadeamento de hash, o que permite auditoria posterior e recomputação de projeções. A UI mostra exatamente esses dados, sem regras próprias e sem poder de alteração.

Arquiteturalmente, o sistema é dividido de forma intencional. A API recebe comandos e expõe apenas projeções de leitura. O worker é o único componente que tem poder de decisão. O banco de dados mantém um ledger imutável e projeções derivadas para leitura rápida. A interface é propositalmente simples e direta, escrita em HTML e JavaScript puro, para maximizar transparência e reduzir camadas desnecessárias. O tamanho do HTML não representa complexidade de frontend, mas sim a superfície necessária para provar o produto funcionando.

Esse projeto existe para demonstrar um tipo específico de maturidade: saber separar poder de observação, saber lidar com decisões assíncronas e saber transformar regras abstratas em algo visível e verificável. Ele assume trade-offs conscientemente. Não há autenticação, multi-tenant ou UI sofisticada porque o foco é mostrar o núcleo do problema e sua solução de forma clara. A latência do processamento é aceita em troca de decisões mais seguras e auditáveis.

Rodar o projeto localmente é simples, mas exige alguns pré-requisitos explícitos. O FreightGuard foi pensado para rodar inteiramente via Docker, sem dependências locais além do Docker e do Docker Compose.

Antes de subir o projeto, é necessário configurar as variáveis de ambiente. O ponto mais importante é a chave da API do OpenWeatherMap, usada pelo worker para buscar o clima real no momento da decisão. Sem essa chave, a stack sobe, mas o worker não consegue decidir operações. No arquivo .env, deve existir a variável OWM_API_KEY com uma chave válida obtida em https://openweathermap.org/api. Esse passo é intencionalmente manual, porque o produto depende de dados externos reais.

Com a chave configurada, o sistema pode ser iniciado com Docker Compose. O comando sobe a API, o worker, a UI, o banco de dados e os serviços auxiliares definidos no projeto. Após o build inicial, a interface fica disponível no navegador.

Depois de subir a stack, o acesso ao produto acontece pela interface web exposta localmente. Não existe login, seed manual ou dados fictícios. Cada operação criada já passa pelo fluxo real de decisão.

O uso segue sempre o mesmo padrão. Primeiro, define-se origem e destino clicando no mapa. Em seguida, envia-se a operação com valor de carga, SLA e penalidade. A API apenas confirma o aceite do comando. Alguns segundos depois, o worker processa a operação, consulta o clima real e grava a decisão. A interface passa a exibir a decisão, o clima utilizado, o custo aplicado e o orçamento restante. Clicando sobre a operação, é possível abrir os detalhes completos e visualizar o JSON auditável.
