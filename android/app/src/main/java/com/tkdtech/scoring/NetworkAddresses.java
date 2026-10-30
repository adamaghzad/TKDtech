package com.tkdtech.scoring;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Current router/hotspot addresses; no address or gateway is hardcoded. */
final class NetworkAddresses {
    private NetworkAddresses() {}

    static List<String> urls(int port) {
        Set<String> addresses = new LinkedHashSet<>();
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress binding : network.getInterfaceAddresses()) {
                    InetAddress address = binding.getAddress();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    String value = address.getHostAddress();
                    if (isPrivateIpv4(value)) addresses.add(value);
                }
            }
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
        List<String> sorted = new ArrayList<>(addresses);
        sorted.sort((left, right) -> {
            int linkLocal = Boolean.compare(left.startsWith("169.254."), right.startsWith("169.254."));
            return linkLocal != 0 ? linkLocal : left.compareTo(right);
        });
        List<String> urls = new ArrayList<>();
        for (String address : sorted) urls.add("http://" + address + ":" + port);
        return urls;
    }

    static String preferredOrigin(int port) {
        List<String> urls = urls(port);
        return urls.isEmpty() ? "" : urls.get(0);
    }

    static String join(List<String> values) {
        if (values.isEmpty()) return "No private router/hotspot IPv4 address is currently available.";
        StringBuilder result = new StringBuilder();
        for (String value : values) {
            if (result.length() > 0) result.append('\n');
            result.append(value);
        }
        return result.toString();
    }

    private static boolean isPrivateIpv4(String address) {
        String[] parts = address.split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]);
            int second = Integer.parseInt(parts[1]);
            for (String part : parts) {
                int value = Integer.parseInt(part);
                if (value < 0 || value > 255) return false;
            }
            return first == 10 || (first == 192 && second == 168)
                || (first == 172 && second >= 16 && second <= 31)
                || (first == 169 && second == 254);
        } catch (NumberFormatException error) {
            return false;
        }
    }
}
