package worker

import (
	"encoding/json"
	"strconv"
	"strings"
)

// NmapService is one open port's service identification produced by `nmap -sV`.
// It is the reliable, protocol-aware signal the discovery pipeline lacks today:
// httpx can only tell us "this spoke HTTP" (and does so unreliably under scan
// load, see the reliability investigation), whereas nmap labels the actual
// service on every open port — http/https, ftp, smtp, imap, pop3, ssh, ... —
// which lets downstream steps make correct decisions before httpx ever runs.
type NmapService struct {
	Port    int    `json:"port"`
	Service string `json:"service"` // nmap label, e.g. "http", "ssl/http", "ftp"
	Product string `json:"product"` // e.g. "Apache httpd", "Pure-FTPd"
	IsWeb   bool   `json:"isWeb"`   // true when the service speaks HTTP(S)
	Scheme  string `json:"scheme"`  // "http" or "https" when IsWeb; otherwise ""
}

// nmapServicesJSON runs the greppable parser and encodes the result as the JSON
// array the Core service-discovery parser consumes. The worker parses nmap
// (rather than shipping raw greppable output to Core) so the greppable-format
// quirks live in one tested place; Core simply JSON-decodes the result.
func nmapServicesJSON(greppable string) (string, error) {
	services := parseNmapServices(greppable)
	if services == nil {
		services = []NmapService{}
	}
	encoded, err := json.Marshal(services)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// nmapServiceInvocation builds an `nmap -sV` service-discovery run scoped to the
// ports naabu already found open on a host. Restricting -p to the known-open
// ports keeps nmap fast — it version-probes a handful of ports rather than
// re-scanning 1000 — and bounds the extra scan footprint (relevant given the
// IPS-block reliability finding). -T3 keeps the timing moderate rather than
// aggressive; --version-intensity 2 uses the lighter probe set. Greppable output
// (-oG -) is emitted for parseNmapServices.
//
// nmap ships as a system package in the worker image (see worker/Dockerfile), so
// it is resolved from PATH rather than the downloaded oasm-tools directory.
func nmapServiceInvocation(host string, ports []int) toolInvocation {
	portList := make([]string, 0, len(ports))
	for _, p := range ports {
		portList = append(portList, strconv.Itoa(p))
	}
	return toolInvocation{
		executable: "nmap",
		args: []string{
			"-sV", "-Pn", "-T3", "--version-intensity", "2",
			"-oG", "-", "-p", strings.Join(portList, ","), host,
		},
	}
}

// parseNmapServices converts `nmap -oG` (greppable) output into per-port service
// identifications. In greppable output each port is encoded as
//
//	port/state/proto/owner/service/rpc/version/
//
// with fields separated by "/" and any literal "/" inside a field escaped as "|"
// (so an SSL-tunnelled HTTP service shows up as service "ssl|http"). Only ports
// reported "open" are returned.
func parseNmapServices(greppable string) []NmapService {
	var services []NmapService
	for _, line := range strings.Split(greppable, "\n") {
		marker := strings.Index(line, "Ports:")
		if marker < 0 {
			continue
		}
		for _, entry := range strings.Split(line[marker+len("Ports:"):], ",") {
			entry = strings.TrimSpace(entry)
			fields := strings.Split(entry, "/")
			if len(fields) < 5 || strings.TrimSpace(fields[1]) != "open" {
				continue
			}
			port, err := strconv.Atoi(strings.TrimSpace(fields[0]))
			if err != nil {
				continue
			}
			// nmap escapes "/" as "|" within a field, so "ssl|http" is really the
			// service "ssl/http".
			service := strings.ReplaceAll(strings.TrimSpace(fields[4]), "|", "/")
			product := ""
			if len(fields) >= 7 {
				product = strings.ReplaceAll(strings.TrimSpace(fields[6]), "|", "/")
			}
			svc := NmapService{Port: port, Service: service, Product: product}
			classifyWebService(&svc)
			services = append(services, svc)
		}
	}
	return services
}

// classifyWebService decides whether an nmap service is an HTTP(S) endpoint and,
// if so, its scheme. nmap labels plain HTTP as "http" and TLS-wrapped HTTP as
// "ssl/http" (occasionally "https"), on ANY port — so a web service on a
// non-standard port (e.g. 9000) is still classified correctly without a port
// allow-list, and legitimate web services are never excluded by port number.
func classifyWebService(svc *NmapService) {
	lower := strings.ToLower(svc.Service)
	if !strings.Contains(lower, "http") {
		return
	}
	svc.IsWeb = true
	if strings.Contains(lower, "ssl") || strings.Contains(lower, "https") {
		svc.Scheme = "https"
	} else {
		svc.Scheme = "http"
	}
}
