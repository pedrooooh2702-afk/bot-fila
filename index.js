const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
  OverwriteType
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]
});

// ================== CONFIGURAÇÕES ==================
const TOKEN = 'MTU3MDU1MTQyMDQxODAwNzA2MA.GNZNRy.6apg1unDg5Ps869boEEpibdFSFVVOcUPE6cWW0';
const CLIENT_ID = '1570551420418007060';
const GUILD_ID = '1518402568198553610';

// ID da categoria onde os tickets vão ser criados
const CATEGORIA_TICKETS = '1518431370819665940';

// Cargos que podem usar os comandos de tester
const CARGO_TESTER = '1518435442884739102';
// ===================================================

let filas = {}; // { "Sword": [ {id, username} ], "Crystal": [] ... }
let tickets = {}; // { channelId: { jogadorId, modo, testers: [] } }

function temPermissaoTester(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || 
         member.roles.cache.has(CARGO_TESTER);
}

// ================== COMANDOS ==================
const commands = [
  new SlashCommandBuilder()
    .setName('fila')
    .setDescription('Gerencia as filas de teste')
    .addSubcommand(sub =>
      sub.setName('criar')
        .setDescription('Abre a fila de um modo')
        .addStringOption(opt =>
          opt.setName('modo')
            .setDescription('Modo de jogo (ex: Sword, Crystal, Pot)')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('fechar')
        .setDescription('Fecha a fila de um modo')
        .addStringOption(opt =>
          opt.setName('modo')
            .setDescription('Modo de jogo')
            .setRequired(true))),

  new SlashCommandBuilder()
    .setName('testar')
    .setDescription('Cria um ticket com o primeiro da fila'),

  new SlashCommandBuilder()
    .setName('result')
    .setDescription('Fecha o ticket e atribui o tier')
    .addStringOption(opt =>
      opt.setName('tier')
        .setDescription('Tier do jogador (ex: High Tier 4)')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gerencia o ticket')
    .addSubcommand(sub =>
      sub.setName('fechar')
        .setDescription('Fecha o ticket atual')),

  new SlashCommandBuilder()
    .setName('adicionar')
    .setDescription('Adiciona um tester ao ticket')
    .addSubcommand(sub =>
      sub.setName('tester')
        .setDescription('Adiciona um tester')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Usuário para adicionar')
            .setRequired(true))),

  new SlashCommandBuilder()
    .setName('remover')
    .setDescription('Remove um tester do ticket')
    .addSubcommand(sub =>
      sub.setName('tester')
        .setDescription('Remove um tester')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Usuário para remover')
            .setRequired(true)))
];

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('Registrando comandos...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Comandos registrados!');
  } catch (err) {
    console.error(err);
  }
})();

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild, channel } = interaction;

  // ========== /fila criar ==========
  if (commandName === 'fila' && options.getSubcommand() === 'criar') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    const modo = options.getString('modo');
    
    if (!filas[modo]) filas[modo] = [];

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📋 Fila - ${modo}`)
      .setDescription(filas[modo].length === 0 
        ? 'Ninguém na fila.\nClique no botão para entrar!'
        : filas[modo].map((u, i) => `**${i+1}.** <@${u.id}>`).join('\n'))
      .setFooter({ text: `Total: ${filas[modo].length}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`entrar_${modo}`)
        .setLabel('Entrar na Fila')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`sair_${modo}`)
        .setLabel('Sair da Fila')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  // ========== /fila fechar ==========
  if (commandName === 'fila' && options.getSubcommand() === 'fechar') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    const modo = options.getString('modo');
    delete filas[modo];
    await interaction.reply({ content: `🗑️ Fila do modo **${modo}** foi fechada.`, ephemeral: true });
  }

  // ========== /testar ==========
  if (commandName === 'testar') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    // Procura a primeira fila que tenha alguém
    let modoEncontrado = null;
    let jogador = null;

    for (const [modo, lista] of Object.entries(filas)) {
      if (lista.length > 0) {
        modoEncontrado = modo;
        jogador = lista.shift(); // tira o primeiro
        break;
      }
    }

    if (!jogador) {
      return interaction.reply({ content: '📭 Nenhuma fila tem jogadores no momento.', ephemeral: true });
    }

    // Cria o canal do ticket
    const ticketChannel = await guild.channels.create({
      name: `teste-${jogador.username || jogador.id}`,
      type: ChannelType.GuildText,
      parent: CATEGORIA_TICKETS,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: jogador.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
        {
          id: member.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
        {
          id: client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
        }
      ]
    });

    tickets[ticketChannel.id] = {
      jogadorId: jogador.id,
      modo: modoEncontrado,
      testers: [member.id]
    };

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🎯 Ticket de Teste Criado')
      .addFields(
        { name: 'Jogador', value: `<@${jogador.id}>`, inline: true },
        { name: 'Modo', value: modoEncontrado, inline: true },
        { name: 'Tester', value: `<@${member.id}>`, inline: true }
      )
      .setFooter({ text: 'Use /result <tier> quando terminar o teste' });

    await ticketChannel.send({ content: `<@${jogador.id}> <@${member.id}>`, embeds: [embed] });
    await interaction.reply({ content: `✅ Ticket criado: ${ticketChannel}`, ephemeral: true });
  }

  // ========== /result ==========
  if (commandName === 'result') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    const ticket = tickets[channel.id];
    if (!ticket) {
      return interaction.reply({ content: '❌ Esse comando só funciona dentro de um ticket.', ephemeral: true });
    }

    const tier = options.getString('tier');

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('✅ Teste Finalizado')
      .addFields(
        { name: 'Jogador', value: `<@${ticket.jogadorId}>`, inline: true },
        { name: 'Modo', value: ticket.modo, inline: true },
        { name: 'Tier', value: tier, inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `Resultado registrado: **${tier}**`, ephemeral: true });

    // Fecha o ticket depois de 5 segundos
    setTimeout(async () => {
      delete tickets[channel.id];
      await channel.delete().catch(() => {});
    }, 5000);
  }

  // ========== /ticket fechar ==========
  if (commandName === 'ticket' && options.getSubcommand() === 'fechar') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    if (!tickets[channel.id]) {
      return interaction.reply({ content: '❌ Esse comando só funciona dentro de um ticket.', ephemeral: true });
    }

    delete tickets[channel.id];
    await interaction.reply({ content: '🔒 Ticket será fechado em 3 segundos...' });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }

  // ========== /adicionar tester ==========
  if (commandName === 'adicionar' && options.getSubcommand() === 'tester') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    const ticket = tickets[channel.id];
    if (!ticket) {
      return interaction.reply({ content: '❌ Esse comando só funciona dentro de um ticket.', ephemeral: true });
    }

    const user = options.getUser('user');
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true
    });

    ticket.testers.push(user.id);
    await interaction.reply({ content: `✅ <@${user.id}> foi adicionado ao ticket.` });
  }

  // ========== /remover tester ==========
  if (commandName === 'remover' && options.getSubcommand() === 'tester') {
    if (!temPermissaoTester(member)) {
      return interaction.reply({ content: '❌ Só testers podem usar esse comando.', ephemeral: true });
    }

    const ticket = tickets[channel.id];
    if (!ticket) {
      return interaction.reply({ content: '❌ Esse comando só funciona dentro de um ticket.', ephemeral: true });
    }

    const user = options.getUser('user');
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: false
    });

    ticket.testers = ticket.testers.filter(id => id !== user.id);
    await interaction.reply({ content: `❌ <@${user.id}> foi removido do ticket.` });
  }
});

// ================== BOTÕES DA FILA ==================
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [acao, ...resto] = interaction.customId.split('_');
  const modo = resto.join('_');

  if (acao === 'entrar') {
    if (!filas[modo]) {
      return interaction.reply({ content: '❌ Essa fila não está mais aberta.', ephemeral: true });
    }

    if (filas[modo].find(u => u.id === interaction.user.id)) {
      return interaction.reply({ content: '❌ Você já está nessa fila!', ephemeral: true });
    }

    filas[modo].push({ id: interaction.user.id, username: interaction.user.username });

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📋 Fila - ${modo}`)
      .setDescription(filas[modo].map((u, i) => `**${i+1}.** <@${u.id}>`).join('\n'))
      .setFooter({ text: `Total: ${filas[modo].length}` });

    await interaction.update({ embeds: [embed] });
  }

  if (acao === 'sair') {
    if (!filas[modo]) {
      return interaction.reply({ content: '❌ Essa fila não está mais aberta.', ephemeral: true });
    }

    const index = filas[modo].findIndex(u => u.id === interaction.user.id);
    if (index === -1) {
      return interaction.reply({ content: '❌ Você não está nessa fila.', ephemeral: true });
    }

    filas[modo].splice(index, 1);

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📋 Fila - ${modo}`)
      .setDescription(filas[modo].length === 0 
        ? 'Ninguém na fila.\nClique no botão para entrar!'
        : filas[modo].map((u, i) => `**${i+1}.** <@${u.id}>`).join('\n'))
      .setFooter({ text: `Total: ${filas[modo].length}` });

    await interaction.update({ embeds: [embed] });
  }
});

client.login(TOKEN);