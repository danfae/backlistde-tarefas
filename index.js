const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

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
      if (!origem || origensPermitidas.includes(origem)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
  const formatoUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!formatoUuid.test(valor)) {
    return res.status(400).json({ erro: "O ID da tarefa é inválido." });
  }

  req.idTarefa = valor;
  next();
});

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

// Lista as tarefas.
app.get(
  "/api/tarefas",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  })
);

// Busca uma tarefa pelo UUID.
app.get(
  "/api/tarefas/:id",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tasks")
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

// Cria uma tarefa.
app.post(
  "/api/tarefas",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const corpo = req.body || {};
    const title = typeof corpo.title === "string" ? corpo.title.trim() : "";

    if (!title) {
      return res.status(400).json({ erro: "Informe o título da tarefa." });
    }

    if (
      corpo.completed !== undefined &&
      typeof corpo.completed !== "boolean"
    ) {
      return res.status(400).json({
        erro: "O campo completed precisa ser true ou false.",
      });
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title,
        completed: corpo.completed ?? false,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  })
);

const atualizarTarefa = tratarRotaAsync(async (req, res) => {
  const corpo = req.body;

  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return res.status(400).json({ erro: "Envie os dados da tarefa." });
  }

  const alteracoes = {};

  if (Object.prototype.hasOwnProperty.call(corpo, "title")) {
    if (typeof corpo.title !== "string" || !corpo.title.trim()) {
      return res.status(400).json({
        erro: "O título precisa ser um texto preenchido.",
      });
    }

    alteracoes.title = corpo.title.trim();
  }

  if (Object.prototype.hasOwnProperty.call(corpo, "completed")) {
    if (typeof corpo.completed !== "boolean") {
      return res.status(400).json({
        erro: "O campo completed precisa ser true ou false.",
      });
    }

    alteracoes.completed = corpo.completed;
  }

  if (Object.keys(alteracoes).length === 0) {
    return res.status(400).json({
      erro: "Envie title ou completed para alterar a tarefa.",
    });
  }

  alteracoes.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("tasks")
    .update(alteracoes)
    .eq("id", req.idTarefa)
    .select()
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return res.status(404).json({ erro: "Tarefa não encontrada." });
  }

  res.json(data);
});

// PUT atende ao método indicado no resumo da aula.
// PATCH também é aceito para facilitar atualizações parciais.
app.put(
  "/api/tarefas/:id",
  verificarConfiguracao,
  atualizarTarefa
);

app.patch(
  "/api/tarefas/:id",
  verificarConfiguracao,
  atualizarTarefa
);

// Marca uma tarefa como concluída.
app.patch(
  "/api/tarefas/:id/concluir",
  verificarConfiguracao,
  tratarRotaAsync(async (req, res) => {
    const { data, error } = await supabase
      .from("tasks")
      .update({
        completed: true,
        updated_at: new Date().toISOString(),
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
      .from("tasks")
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
