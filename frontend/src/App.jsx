import { useState, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import axios from 'axios'
import { Calendar as CalendarIcon, RefreshCw, AlertCircle, X, Clock, User, Info, Activity, Stethoscope } from 'lucide-react'

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const fetchAgendamentos = async () => {
    setLoading(true);
    setError(null);
    try {
      // Endpoint da nossa API Local
      const response = await axios.get('http://localhost:3001/api/agendamentos');
      setEvents(response.data);
    } catch (err) {
      console.error("Erro ao buscar agendamentos", err);
      setError("Não foi possível conectar ao banco de dados (API Local desligada ou erro no Firebird).");
      // Fallback para demonstrar visualmente
      setEvents([
        {
          id: '1',
          title: 'Rex - Cachorro (João Silva)',
          start: new Date().toISOString(),
          extendedProps: { diagnostico: 'Vacina Anual' }
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Busca inicial
    fetchAgendamentos();

    // Auto-Refresh silencioso a cada 2 minutos (120000 milissegundos)
    const intervalId = setInterval(() => {
      fetchAgendamentos();
    }, 120000);

    // Limpeza de memória
    return () => clearInterval(intervalId);
  }, []);

  const handleEventClick = (clickInfo) => {
    setSelectedEvent(clickInfo.event);
  };

  const renderEventContent = (eventInfo) => {
    try {
      const customTime = eventInfo.event.extendedProps?.hora_texto || eventInfo.timeText || '';
      const title = eventInfo.event.title || '';
      const isMonth = eventInfo.view.type === 'dayGridMonth';

      if (isMonth) {
        return (
          <div className="truncate text-[10px] px-1 font-semibold leading-tight text-white w-full flex items-center gap-1">
            <b className="shrink-0">{String(customTime).split(' - ')[0]}</b>
            <span className="opacity-90 truncate">{String(title).split(' - ')[0]}</span>
          </div>
        );
      }

      return (
        <div className="flex flex-col p-1 w-full h-full overflow-hidden leading-tight text-[11px]">
          <div className="flex flex-wrap gap-x-1">
            <b className="font-bold">{customTime}</b>
            <span className="font-semibold text-white/90">{title}</span>
          </div>
        </div>
      );
    } catch (err) {
      console.error(err);
      return <div className="text-white text-xs px-1">Erro</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Header Premium */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {/* Logo da Empresa. Coloque o arquivo logo.svg na pasta frontend/public */}
          <div className="h-12 w-32 flex items-center justify-center bg-transparent overflow-hidden">
            <img
              src="/logo.svg"
              alt="Logo LMD"
              className="max-h-full max-w-full object-contain"
              onError={(e) => {
                // Fallback para ícone caso você ainda não tenha colocado a imagem na pasta
                e.target.outerHTML = '<div class="bg-blue-600 p-2.5 rounded-xl shadow-inner flex items-center justify-center"><svg class="w-6 h-6 text-white" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg></div>';
              }}
            />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-800 tracking-tight">Agenda <span className="text-blue-600">LMD</span></h1>
            <p className="text-sm text-gray-500 font-medium">Painel de Agendamentos</p>
          </div>
        </div>

        <button
          onClick={fetchAgendamentos}
          disabled={loading}
          className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 text-gray-700 px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Sincronizar
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-[1400px] mx-auto w-full flex flex-col">

        {error && (
          <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700 text-sm font-medium">{error} Exibindo dados de teste.</p>
          </div>
        )}

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex-1 min-h-[600px] flex flex-col">
          <div className="flex-1">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="timeGridWeek"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
              }}
              events={events}
              eventContent={renderEventContent}
              eventClick={handleEventClick}
              locale={ptBrLocale}
              buttonText={{
                today: 'Hoje',
                month: 'Mês',
                week: 'Semana',
                day: 'Dia',
                list: 'Lista'
              }}
              allDaySlot={false}
              slotMinTime="07:00:00"
              slotMaxTime="20:00:00"
              height={650}
              dayMaxEvents={true}
              slotDuration="00:30:00"
              slotLabelInterval="00:30:00"
              defaultTimedEventDuration="00:30:00"
              eventDisplay="block"
              nowIndicator={true}
              slotLabelFormat={{
                hour: '2-digit',
                minute: '2-digit',
                omitZeroMinute: false,
                meridiem: false
              }}
            />
          </div>
        </div>
      </main>

      {/* Modal de Detalhes do Agendamento */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col transform transition-all animate-in fade-in zoom-in-95 duration-200">

            {/* Header do Modal */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold mb-1 truncate pr-4">
                  {selectedEvent.title.split(' - ')[0]}
                </h2>
                <p className="text-blue-100 flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4" />
                  {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(selectedEvent.start)}
                  {selectedEvent.extendedProps?.hora_texto ? `, ${selectedEvent.extendedProps.hora_texto}` : `, ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(selectedEvent.start)}`}
                </p>
                <div className="mt-2">
                  <span className="bg-blue-800/50 px-2 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-blue-50 border border-blue-500/30">
                    Animal - {selectedEvent.extendedProps?.animal || 'Indefinido'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-white hover:bg-white/20 p-2 rounded-full transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Corpo do Modal */}
            <div className="p-6 space-y-6">

              {/* Infos Principais */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="bg-gray-100 p-2 rounded-lg text-gray-600">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-0.5">Tutor</p>
                    <p className="text-gray-800 font-semibold text-sm truncate">
                      {selectedEvent.title.split('(')[1]?.replace(')', '') || 'Não informado'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="bg-blue-50 p-2 rounded-lg text-blue-600">
                    <Stethoscope className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-xs text-blue-600 font-bold uppercase tracking-wider mb-0.5">Técnico</p>
                    <p className="text-gray-800 font-semibold text-sm truncate">
                      {selectedEvent.extendedProps?.tecnico || 'Não atribuído'}
                    </p>
                  </div>
                </div>
              </div>

              <hr className="border-gray-100" />

              {/* Infos do Pet */}
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4" /> Detalhes do Paciente
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[11px] text-gray-500 mb-0.5 font-semibold uppercase">Raça</p>
                    <p className="font-bold text-gray-800 text-sm truncate">{selectedEvent.extendedProps?.raca || '--'}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[11px] text-gray-500 mb-0.5 font-semibold uppercase">Idade</p>
                    <p className="font-bold text-gray-800 text-sm truncate">{selectedEvent.extendedProps?.idade || '--'}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[11px] text-gray-500 mb-0.5 font-semibold uppercase">Peso</p>
                    <p className="font-bold text-gray-800 text-sm truncate">{selectedEvent.extendedProps?.peso ? `${selectedEvent.extendedProps.peso} kg` : '--'}</p>
                  </div>
                </div>
              </div>

              {/* Diagnóstico */}
              {selectedEvent.extendedProps?.diagnostico && selectedEvent.extendedProps.diagnostico !== 'null' && (
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                  <p className="text-xs text-blue-700 font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Observações / Diagnóstico
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                    {selectedEvent.extendedProps.diagnostico}
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
