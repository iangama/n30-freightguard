N30 FreightGuard
O que é o FreightGuard?

O FreightGuard é um motor de decisão para operações de frete. Ele responde a uma pergunta concreta do mundo real:

Dado um frete agora, com origem, destino, SLA, valor de carga e clima real, essa operação deve ser autorizada, autorizada com custo adicional ou bloqueada?

O sistema não é apenas uma API nem apenas uma interface visual. Ele é um produto de decisão, no qual o ato de decidir é tratado como algo explícito, registrável e auditável.

As decisões não acontecem de forma síncrona nem na API nem na UI. O poder de decidir está concentrado em um worker assíncrono, enquanto os demais componentes apenas enviam comandos ou observam resultados.

Visão de produto

Em sistemas logísticos tradicionais, decisões críticas costumam ficar implícitas: regras são aplicadas em código síncrono, o contexto externo muda com o tempo e, depois que a decisão é tomada, torna-se difícil explicar por que ela aconteceu.

O FreightGuard foi projetado para inverter essa lógica:

Decisões têm custo explícito

Decisões dependem de contexto externo real (clima)

Decisões precisam ser explicáveis depois de tomadas

Aqui, o resultado final importa, mas o processo que levou até ele importa ainda mais.

Fluxo do sistema

Do ponto de vista do usuário, o fluxo é simples e direto:

O usuário abre a interface web

Define origem e destino clicando no mapa

Informa valor da carga, SLA e penalidade

Envia a operação

O que acontece internamente:

A API recebe o comando e apenas o registra

Nenhuma decisão é tomada nesse momento

Um worker assíncrono processa a operação

O worker:

consulta o clima real (OpenWeatherMap)

aplica regras de risco

verifica orçamento disponível

produz uma decisão definitiva

A decisão é persistida com:

clima utilizado

timestamp

custo aplicado

orçamento restante

A interface passa a exibir o resultado de forma clara e auditável

Auditoria e explicabilidade

O ponto central do FreightGuard não é apenas a decisão final, mas a capacidade de provar como ela foi produzida.

O clima utilizado na decisão não é recalculado depois

Ele é persistido como evidência

Cada decisão gera um evento em um ledger imutável

Os eventos são encadeados por hash-chain

Isso permite:

Auditoria posterior

Verificação de integridade

Recomputação de projeções

Análise histórica de decisões

A interface exibe exatamente esses dados. Ela não possui regras próprias nem poder de alteração.

Arquitetura

A separação entre componentes é intencional e explícita. Cada parte do sistema tem um papel bem definido.

API

Recebe comandos de criação de operações

Não contém regras de decisão

Expõe apenas projeções de leitura

Worker assíncrono

Único componente com poder de decisão

Processa operações fora do fluxo síncrono

Consulta clima real

Aplica regras de risco e orçamento

Registra decisões no ledger

Banco de dados

Ledger imutável de eventos

Encadeamento por hash

Projeções derivadas para leitura eficiente

Interface web

Escrita em HTML e JavaScript puro

Não toma decisões

Apenas observa e exibe dados

A simplicidade do frontend é proposital. O foco não é complexidade visual, mas transparência do produto funcionando.

Trade-offs conscientes

Este projeto assume escolhas claras:

Não há autenticação ou multi-tenant

A UI é simples, sem frameworks

A decisão é assíncrona (latência aceita)

O foco está no núcleo do problema, não em features periféricas

Esses trade-offs existem para manter o sistema legível, verificável e fácil de auditar.

Tecnologias principais

Docker / Docker Compose

API backend

Worker assíncrono

Banco relacional com ledger e projeções

OpenWeatherMap (dados climáticos reais)

HTML + JavaScript puro

Como rodar o projeto
Pré-requisitos

Docker

Docker Compose

Configuração obrigatória

O FreightGuard depende de dados externos reais. Antes de subir a stack, é necessário configurar a chave da API do OpenWeatherMap.

Crie uma conta em: https://openweathermap.org/api

Obtenha uma chave de API

No arquivo .env, defina:

OWM_API_KEY=SUA_CHAVE_AQUI

Sem essa chave, o sistema sobe, mas o worker não consegue decidir operações.

Subindo a stack

Com a variável configurada, basta executar:

docker compose up -d --build

Isso inicia:

API

Worker

Interface web

Banco de dados

Serviços auxiliares

Após o build inicial, a interface fica disponível no navegador.

Uso do sistema

Acesse a interface web

Clique no mapa para definir origem e destino

Preencha os dados da operação

Envie o comando

Aguarde alguns segundos

Observe a decisão aparecer na interface

Cada operação exibida pode ser clicada para visualizar os detalhes completos, incluindo

clima utilizado

decisão

custo

orçamento restante

JSON auditável da projeção

Objetivo do projeto

Este projeto existe para demonstrar um tipo específico de maturidade técnica:

Separar poder de decisão de camadas de observação

Lidar com decisões assíncronas

Integrar dados externos reais de forma segura

Tornar decisões explicáveis e auditáveis

Ele não tenta ser um produto comercial completo. Ele tenta ser honesto sobre o problema que resolve e explícito sobre as escolhas feitas para resolvê-lo.

Status

Projeto funcional, voltado para demonstração arquitetural e de produto.
> As imagens abaixo mostram o produto rodando com dados reais,
> decisões assíncronas e histórico auditável.
<img width="1919" height="971" alt="Prova1" src="https://github.com/user-attachments/assets/1d9ba517-4e2b-4ac7-8546-195203c3f852" />
<img width="1913" height="932" alt="Prova2" src="https://github.com/user-attachments/assets/61d1ae96-d9fe-4cbf-b2ce-2970164d364d" />
