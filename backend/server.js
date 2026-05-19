const express = require('express');
const cors = require('cors');
const { getAgendamentos, getAgendamentoDetalhes } = require('./db.js');

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
    if (typeof val === 'function') return '';
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

app.get('/api/agendamentos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const detalhes = await getAgendamentoDetalhes(id);
        if (!detalhes) {
            return res.status(404).json({ error: 'Agendamento não encontrado.' });
        }
        res.json({
            id: detalhes.OS_ID.toString(),
            diagnostico: parseString(detalhes.DIAGNOSTICO) || 'Sem observações/diagnóstico cadastrado.',
            laudo: parseString(detalhes.LAUDO) || ''
        });
    } catch (error) {
        console.error('Erro na rota /api/agendamentos/:id:', error);
        res.status(500).json({ error: 'Erro ao buscar detalhes do agendamento.', details: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 API Local (Preview) rodando na porta ${PORT}`);
});
