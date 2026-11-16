const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// Endereços autorizados para acessar a API pelo navegador.
const origensPermitidas = [
  process.env.FRONTEND_URL,
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

app.use(
  cors({
    origin: (origem, callback) => {
      // Permite chamadas sem Origin, como testes por ferramentas de API.
      if (!origem || origensPermitidas.includes(origem)) {
        return callback(null, true);
      }

      // Origens que não estão na lista não recebem permissão CORS.
      return callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);

app.use(express.json({ limit: "10kb" }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : null;

function verificarConfiguracao(req, res, next) {
  if (!supabase) {
    return res.status(503).json({
      erro: "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY na Vercel.",
    });
  }

  next();
}

function tratarRotaAsync(rota) {
  return (req, res, next) => {
    Promise.resolve(rota(req, res, next)).catch(next);
  };
}

app.param("id", (req, res, next, valor) => {
  const id = Number(valor);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ erro: "O ID da tarefa é inválido." });
  }

  req.idTarefa = id;
  next();
});

function validarDescricao(descricao) {
  if (descricao === undefined || descricao === null) {
    return { valida: true, valor: null };
  }

  if (typeof descricao !== "string") {
    return { valida: false, valor: null };
  }

  return {
    valida: true,
    valor: descricao.trim() || null,
  };
}

app.get("/", (req, res) => {
  res.json({
    mensagem: "API da lista de tarefas",
    rotas: {
      verificar: "/api/health",
      tarefas: "/api/tarefas",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Lista todas as tarefas.
app.get(
  "/api/tarefas",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tarefas")
      .select("*")
      .order("criada_em", { ascending: false });

    if (error) throw error;

    res.json(data);
  })
);

// Busca uma tarefa pelo ID.
app.get(
  "/api/tarefas/:id",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tarefas")
      .select("*")
      .eq("id", req.idTarefa)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ erro: "Tarefa não encontrada." });
    }

    res.json(data);
  })
);

// Cadastra uma tarefa.
app.post(
  "/api/tarefas",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const corpo = req.body || {};
    const titulo =
      typeof corpo.titulo === "string" ? corpo.titulo.trim() : "";

    if (!titulo) {
      return res.status(400).json({
        erro: "Informe um título para a tarefa.",
      });
    }

    const descricao = validarDescricao(corpo.descricao);

    if (!descricao.valida) {
      return res.status(400).json({
        erro: "A descrição precisa ser um texto.",
      });
    }

    const { data, error } = await supabase
      .from("tarefas")
      .insert({
        titulo,
        descricao: descricao.valor,
        concluida: false,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  })
);

// Edita o título, a descrição ou o estado de conclusão.
app.patch(
  "/api/tarefas/:id",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const corpo = req.body;

    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
      return res.status(400).json({ erro: "Envie os dados da tarefa." });
    }

    const alteracoes = {};

    if (Object.prototype.hasOwnProperty.call(corpo, "titulo")) {
      if (typeof corpo.titulo !== "string" || !corpo.titulo.trim()) {
        return res.status(400).json({
          erro: "O título precisa ser um texto preenchido.",
        });
      }

      alteracoes.titulo = corpo.titulo.trim();
    }

    if (Object.prototype.hasOwnProperty.call(corpo, "descricao")) {
      const descricao = validarDescricao(corpo.descricao);

      if (!descricao.valida) {
        return res.status(400).json({
          erro: "A descrição precisa ser um texto.",
        });
      }

      alteracoes.descricao = descricao.valor;
    }

    if (Object.prototype.hasOwnProperty.call(corpo, "concluida")) {
      if (typeof corpo.concluida !== "boolean") {
        return res.status(400).json({
          erro: "O campo concluida precisa ser true ou false.",
        });
      }

      alteracoes.concluida = corpo.concluida;
    }

    if (Object.keys(alteracoes).length === 0) {
      return res.status(400).json({
        erro: "Envie pelo menos um campo para alterar.",
      });
    }

    alteracoes.atualizada_em = new Date().toISOString();

    const { data, error } = await supabase
      .from("tarefas")
      .update(alteracoes)
      .eq("id", req.idTarefa)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ erro: "Tarefa não encontrada." });
    }

    res.json(data);
  })
);

// Marca uma tarefa como concluída.
app.patch(
  "/api/tarefas/:id/concluir",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tarefas")
      .update({
        concluida: true,
        atualizada_em: new Date().toISOString(),
      })
      .eq("id", req.idTarefa)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ erro: "Tarefa não encontrada." });
    }

    res.json(data);
  })
);

// Exclui uma tarefa.
app.delete(
  "/api/tarefas/:id",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tarefas")
      .delete()
      .eq("id", req.idTarefa)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ erro: "Tarefa não encontrada." });
    }

    res.json({
      mensagem: "Tarefa excluída com sucesso.",
      id: data.id,
    });
  })
);

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ erro: "O JSON enviado está inválido." });
  }

  console.error("Erro na API:", error.message);

  res.status(500).json({
    erro: "Ocorreu um erro no servidor. Consulte os logs da Vercel.",
  });
});

if (!process.env.VERCEL) {
  const porta = process.env.PORT || 3000;

  app.listen(porta, () => {
    console.log(`Servidor iniciado na porta ${porta}`);
  });
}

module.exports = app;
