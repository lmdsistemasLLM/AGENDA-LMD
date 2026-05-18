const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { getAgendamentos } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

function parseDateTime(dateObj, timeObj, isEnd = false) {
    if (!dateObj) return null;
    
    const d = new Date(dateObj);
    
    if (timeObj && timeObj instanceof Date) {
        d.setHours(timeObj.getHours(), timeObj.getMinutes(), timeObj.getSeconds());
        // Se for o horário de término, adicionamos 30 min para preencher o bloco visualmente
        if (isEnd) {
            d.setMinutes(d.getMinutes() + 30);
        }
    }
    return d.toISOString();
}

function formatOriginalTime(timeObj) {
    if (!timeObj || !(timeObj instanceof Date)) return null;
    const h = timeObj.getHours().toString().padStart(2, '0');
    const m = timeObj.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

// Retorna buffer para string caso necessário
function parseString(val) {
    if (!val) return null;
    // O node-firebird retorna BLOBs como funções de leitura. Ignoramos no preview rápido.
    if (typeof val === 'function') return '[Diagnóstico Omitido - Texto Longo]';
    return val.toString();
}

app.get('/api/agendamentos', async (req, res) => {
    try {
        const empresa = parseInt(req.query.empresa) || 1;
        const registros = await getAgendamentos(empresa);
        
        const formatados = registros.map(os => {
            const petNome = parseString(os.NOME_DO_PET) || 'Pet sem nome';
            const animal = parseString(os.ANIMAL) || 'Indefinido';
            const tutor = parseString(os.TUTOR_NOME) || 'Sem Tutor';

            return {
                id: os.OS_ID.toString(),
                title: `${petNome} - ${animal} (${tutor})`,
                start: parseDateTime(os.DATA_AGENDAMENTO, os.HORA_DO_AGENDAMENTO),
                end: parseDateTime(os.DATA_ENTREGA, os.HORA_TERMINO, true),
                extendedProps: {
                    tecnico: parseString(os.TECNICO_NOME),
                    diagnostico: parseString(os.DIAGNOSTICO),
                    idade: parseString(os.IDADE_DO_PET),
                    raca: parseString(os.RACA_DO_PET),
                    peso: parseString(os.KG_DO_PET),
                    animal: animal,
                    hora_texto: (formatOriginalTime(os.HORA_DO_AGENDAMENTO) || '') + (os.HORA_TERMINO ? ' - ' + formatOriginalTime(os.HORA_TERMINO) : '')
                }
            };
        });

        res.json(formatados);
    } catch (error) {
        console.error('Erro na rota /api/agendamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar agendamentos do banco de dados.', details: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 API Local (Preview) rodando na porta ${PORT}`);
});
