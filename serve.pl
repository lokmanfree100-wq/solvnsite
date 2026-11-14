#!/usr/bin/perl
# Solvn local dev server.
#
#   perl serve.pl [port] [root]
#
# Serves the site as static files. Each connection handles exactly one request
# and is closed, and every request is served in a forked child, so a browser's
# ~40 parallel module requests never block each other and a dropped connection
# cannot take the accept loop down with it.
use strict;
use warnings;
use HTTP::Daemon;
use HTTP::Response;
use HTTP::Status;
use POSIX qw(WNOHANG);

my $port = $ARGV[0] || 4174;
my $root = $ARGV[1] || '.';
$root =~ s{\\}{/}g;
$root =~ s{/+$}{};

my %mime = (
  html => 'text/html; charset=utf-8',
  htm  => 'text/html; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  js   => 'application/javascript; charset=utf-8',
  mjs  => 'application/javascript; charset=utf-8',
  json => 'application/json; charset=utf-8',
  jpg  => 'image/jpeg',
  jpeg => 'image/jpeg',
  png  => 'image/png',
  gif  => 'image/gif',
  webp => 'image/webp',
  svg  => 'image/svg+xml',
  ico  => 'image/x-icon',
  woff => 'font/woff',
  woff2=> 'font/woff2',
  ttf  => 'font/ttf',
  otf  => 'font/otf',
  txt  => 'text/plain; charset=utf-8',
  xml  => 'application/xml',
  map  => 'application/json',
);

sub serve_one {
  my ($c) = @_;
  my $r = eval { $c->get_request };
  return unless $r;

  my $path = $r->url->path || '/';
  $path =~ s/%([0-9a-fA-F]{2})/chr(hex($1))/ge;
  $path = '/index.html' if $path eq '/';
  $path =~ s{/+}{/}g;

  if ($path =~ /\.\./) {
    $c->send_response(HTTP::Response->new(RC_FORBIDDEN, 'Forbidden',
      ['Content-Type' => 'text/plain', 'Connection' => 'close'], 'Forbidden'));
    return;
  }

  my $file = $root . $path;
  $file .= '/index.html' if -d $file;

  if (!-f $file) {
    $c->send_response(HTTP::Response->new(RC_NOT_FOUND, 'Not Found',
      ['Content-Type' => 'text/plain', 'Connection' => 'close'], "404 $path"));
    return;
  }

  my ($ext) = $file =~ /\.([^.]+)$/;
  my $ct = $mime{lc($ext // '')} || 'application/octet-stream';

  open my $fh, '<:raw', $file or do {
    $c->send_response(HTTP::Response->new(RC_INTERNAL_SERVER_ERROR, 'Error',
      ['Content-Type' => 'text/plain', 'Connection' => 'close'], 'read error'));
    return;
  };
  local $/;
  my $data = <$fh>;
  close $fh;

  $c->send_response(HTTP::Response->new(200, 'OK', [
    'Content-Type'   => $ct,
    'Content-Length' => length($data),
    'Cache-Control'  => 'no-cache',
    'Connection'     => 'close',
  ], $data));
}

my $d = HTTP::Daemon->new(
  LocalAddr => '127.0.0.1',
  LocalPort => $port,
  ReuseAddr => 1,
  Listen    => 64,
) or die "Cannot listen on 127.0.0.1:$port: $!";

$| = 1;
print "Serving $root on http://127.0.0.1:$port/\n";

while (1) {
  my $c = $d->accept or next;
  my $pid = fork();
  if (!defined $pid) {
    # Fork failed: serve inline rather than drop the request.
    eval { serve_one($c) };
    close $c;
    next;
  }
  if ($pid == 0) {
    # Child.
    $d->close;
    eval { serve_one($c) };
    close $c;
    exit 0;
  }
  # Parent: close our copy and reap finished children.
  close $c;
  while (waitpid(-1, WNOHANG) > 0) { }
}
